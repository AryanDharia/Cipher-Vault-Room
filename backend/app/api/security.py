import json
import asyncio
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database.session import get_db
from app.database.models import User, Room, RoomMember, AuditEvent, utcnow
from app.auth.dependencies import get_current_user, get_room_and_membership
from app.ai.anomaly_detector import anomaly_detector
from app.heist.simulator import HeistSimulator
from app.collaboration.manager import manager

router = APIRouter(prefix="/rooms/{code}", tags=["Security & Audit"])

class EvaluateAnomalyRequest(BaseModel):
    export_rate: float = 0.0
    auth_failures: float = 0.0
    request_rate: float = 1.0
    perm_changes: float = 0.0
    sensitive_access: float = 0.0
    is_simulated_demo: bool = False

@router.get("/audit")
async def get_audit_trail(
    code: str,
    limit: int = 50,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, _ = await get_room_and_membership(code, user, db)
    result = await db.execute(
        select(AuditEvent)
        .where(AuditEvent.room_id == room.id)
        .order_by(AuditEvent.timestamp.desc())
        .limit(min(limit, 200))
    )
    events = result.scalars().all()
    return [
        {
            "id": e.id,
            "timestamp": e.timestamp.isoformat(),
            "username": e.username,
            "event_type": e.event_type,
            "severity": e.severity,
            "details": json.loads(e.details_json) if e.details_json else {},
            "is_simulated": e.is_simulated
        }
        for e in events
    ]

@router.post("/security/evaluate")
async def evaluate_security(
    code: str,
    req: EvaluateAnomalyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, _ = await get_room_and_membership(code, user, db)
    metrics = {
        "export_rate": req.export_rate,
        "auth_failures": req.auth_failures,
        "request_rate": req.request_rate,
        "perm_changes": req.perm_changes,
        "sensitive_access": req.sensitive_access
    }

    result = anomaly_detector.evaluate_activity(metrics, is_simulated_demo=req.is_simulated_demo)

    if result["is_anomaly"]:
        # Record audit alert
        audit = AuditEvent(
            room_id=room.id,
            user_id=user.id,
            username=user.username,
            event_type="ANOMALY_FLAGGED",
            severity=result["severity"],
            details_json=json.dumps(result),
            is_simulated=req.is_simulated_demo
        )
        db.add(audit)
        await db.commit()

        # Broadcast alert to all room members
        await manager.broadcast(room.code, {
            "type": "SECURITY_ANOMALY_ALERT",
            "threat_score": result["threat_score"],
            "severity": result["severity"],
            "dominant_signal": result["dominant_signal"],
            "recommended_action": result["recommended_action"],
            "is_simulated": req.is_simulated_demo
        })

    return result

@router.post("/heist/start")
async def start_heist_simulation(
    code: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    room, member = await get_room_and_membership(code, user, db)
    if member.role not in ("owner", "key_holder"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Room Owners or Key Holders can initiate Heist Mode simulation"
        )

    timeline = HeistSimulator.get_simulation_timeline()
    report = HeistSimulator.generate_incident_report(room.code)

    # Record beginning of simulation
    audit_start = AuditEvent(
        room_id=room.id,
        user_id=user.id,
        username=user.username,
        event_type="HEIST_SIMULATION_INITIATED",
        severity="alert",
        details_json=json.dumps({"operator": user.username, "mode": "30s_scripted_demo"}),
        is_simulated=True
    )
    db.add(audit_start)
    await db.commit()

    # Broadcast simulation trigger over WebSocket
    await manager.broadcast(room.code, {
        "type": "HEIST_SIMULATION_STARTED",
        "timeline": timeline,
        "started_by": user.username
    })

    return {
        "status": "simulation_active",
        "timeline": timeline,
        "report": report
    }
