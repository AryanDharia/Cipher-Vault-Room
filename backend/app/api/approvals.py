import json
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database.session import get_db
from app.database.models import User, Room, RoomMember, ThresholdApproval, AuditEvent, utcnow, to_naive_utc
from app.auth.dependencies import get_current_user, get_room_and_membership
from app.collaboration.manager import manager

router = APIRouter(prefix="/rooms/{code}/approvals", tags=["Threshold Approvals"])

class CreateApprovalRequest(BaseModel):
    document_id: Optional[str] = None
    target_resource: str = Field(..., description="E.g. doc:id or secret:id")
    description: Optional[str] = "Request to unlock threshold-protected resource"

class VoteApprovalRequest(BaseModel):
    decision: str = Field(..., pattern="^(approve|reject)$")
    reason: Optional[str] = None

@router.get("")
async def list_approvals(
    code: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, _ = await get_room_and_membership(code, user, db)
    result = await db.execute(
        select(ThresholdApproval).where(ThresholdApproval.room_id == room.id).order_by(ThresholdApproval.created_at.desc())
    )
    approvals = result.scalars().all()
    
    # Check expiry
    now = utcnow()
    output = []
    for a in approvals:
        if a.status == "pending" and to_naive_utc(a.expires_at) < now:
            a.status = "expired"
        
        votes = json.loads(a.approvals_json) if a.approvals_json else []
        output.append({
            "id": a.id,
            "document_id": a.document_id,
            "target_resource": a.target_resource,
            "status": a.status,
            "required_count": a.required_count,
            "current_count": len([v for v in votes if v.get("decision") == "approve"]),
            "votes": votes,
            "created_at": a.created_at.isoformat(),
            "expires_at": a.expires_at.isoformat()
        })
    await db.commit()
    return output

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_approval_request(
    code: str,
    req: CreateApprovalRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, member = await get_room_and_membership(code, user, db)
    now = utcnow()
    expires_at = now + timedelta(hours=2)

    approval = ThresholdApproval(
        room_id=room.id,
        document_id=req.document_id,
        requested_by=user.id,
        target_resource=req.target_resource,
        status="pending",
        required_count=room.threshold_required,
        approvals_json="[]",
        created_at=now,
        expires_at=expires_at
    )
    db.add(approval)
    await db.flush()

    audit = AuditEvent(
        room_id=room.id,
        user_id=user.id,
        username=user.username,
        event_type="APPROVAL_REQUESTED",
        severity="info",
        details_json=f'{{"approval_id":"{approval.id}","target":"{req.target_resource}","required":{room.threshold_required}}}'
    )
    db.add(audit)
    await db.commit()
    await db.refresh(approval)

    await manager.broadcast(room.code, {
        "type": "THRESHOLD_APPROVAL_REQUESTED",
        "approval_id": approval.id,
        "target_resource": approval.target_resource,
        "requested_by": user.username,
        "required_count": approval.required_count
    })

    return {
        "id": approval.id,
        "status": approval.status,
        "target_resource": approval.target_resource,
        "required_count": approval.required_count,
        "expires_at": approval.expires_at.isoformat()
    }

@router.post("/{approval_id}/vote")
async def vote_approval(
    code: str,
    approval_id: str,
    req: VoteApprovalRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, member = await get_room_and_membership(code, user, db)
    # Only key_holder, co_host, or owner can cast approvals
    if member.role not in ("owner", "key_holder", "co_host"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only designated Key Holders, Room Hosts, or Co-Hosts can approve threshold key access"
        )

    res = await db.execute(
        select(ThresholdApproval).where(ThresholdApproval.id == approval_id, ThresholdApproval.room_id == room.id)
    )
    approval = res.scalar_one_or_none()
    if not approval:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval request not found")

    if approval.status != "pending":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Approval is already {approval.status}")

    if to_naive_utc(approval.expires_at) < utcnow():
        approval.status = "expired"
        await db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Approval request has expired")

    votes = json.loads(approval.approvals_json) if approval.approvals_json else []
    # Prevent duplicate approvals by same user
    if any(v.get("user_id") == user.id for v in votes):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You have already cast your vote for this request")

    votes.append({
        "user_id": user.id,
        "username": user.username,
        "decision": req.decision,
        "reason": req.reason,
        "timestamp": utcnow().isoformat()
    })
    approval.approvals_json = json.dumps(votes)

    approvals_count = len([v for v in votes if v.get("decision") == "approve"])
    rejections_count = len([v for v in votes if v.get("decision") == "reject"])

    if approvals_count >= approval.required_count:
        approval.status = "approved"
    elif rejections_count > (room.threshold_total - approval.required_count):
        approval.status = "rejected"

    audit = AuditEvent(
        room_id=room.id,
        user_id=user.id,
        username=user.username,
        event_type="APPROVAL_VOTED",
        severity="info" if req.decision == "approve" else "warning",
        details_json=f'{{"approval_id":"{approval.id}","decision":"{req.decision}","status":"{approval.status}","approvals_count":{approvals_count}}}'
    )
    db.add(audit)
    await db.commit()

    await manager.broadcast(room.code, {
        "type": "THRESHOLD_APPROVAL_UPDATED",
        "approval_id": approval.id,
        "status": approval.status,
        "current_approvals": approvals_count,
        "required_count": approval.required_count
    })

    return {
        "id": approval.id,
        "status": approval.status,
        "required_count": approval.required_count,
        "current_count": approvals_count,
        "votes": votes
    }
