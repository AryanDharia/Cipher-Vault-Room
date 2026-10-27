import asyncio
import time
from typing import Dict, Any, List
from app.ai.anomaly_detector import anomaly_detector

class HeistSimulator:
    """
    Controlled, deterministic 30-second Heist Mode simulation engine.
    Demonstrates VaultRoom's active defenses without targeting real systems
    or compromising real documents.
    """
    @staticmethod
    def get_simulation_timeline() -> List[Dict[str, Any]]:
        return [
            {
                "step": 1,
                "elapsed_seconds": 2,
                "event_type": "SIMULATED_RECON_PROBE",
                "severity": "warning",
                "actor": "Simulated Entity [External Node: 198.51.100.42]",
                "description": "High-velocity metadata probing detected on room entry points.",
                "is_simulated": True
            },
            {
                "step": 2,
                "elapsed_seconds": 7,
                "event_type": "SIMULATED_KEY_VAULT_EXFIL_ATTEMPT",
                "severity": "critical",
                "actor": "Simulated Adversary [Key Harvester Script]",
                "description": "Attempted bulk extraction of protected vault credentials and API keys.",
                "is_simulated": True
            },
            {
                "step": 3,
                "elapsed_seconds": 13,
                "event_type": "AI_ANOMALY_GUARD_TRIGGERED",
                "severity": "critical",
                "actor": "VaultRoom Isolation Forest Guard",
                "description": "Metadata anomaly threshold exceeded (threat score: 0.942). Dominant vector: vault_exfiltration.",
                "is_simulated": True
            },
            {
                "step": 4,
                "elapsed_seconds": 18,
                "event_type": "SIMULATED_THRESHOLD_BYPASS_ATTEMPT",
                "severity": "critical",
                "actor": "Simulated Adversary",
                "description": "Adversary attempted direct document key decryption bypassing 2-of-3 key-holder approvals.",
                "is_simulated": True
            },
            {
                "step": 5,
                "elapsed_seconds": 23,
                "event_type": "AUTOMATED_LOCKDOWN_ENGAGED",
                "severity": "alert",
                "actor": "VaultRoom Defense Orchestrator",
                "description": "Room write capabilities suspended. Zero-knowledge envelopes preserved. Export APIs isolated.",
                "is_simulated": True
            },
            {
                "step": 6,
                "elapsed_seconds": 28,
                "event_type": "INCIDENT_REPORT_COMPILED",
                "severity": "info",
                "actor": "VaultRoom Security Auditor",
                "description": "Simulation concluded. Zero plaintext leakage verified. System restored to safe inspection state.",
                "is_simulated": True
            }
        ]

    @staticmethod
    def generate_incident_report(room_code: str) -> Dict[str, Any]:
        return {
            "report_id": f"REP-HEIST-{int(time.time())}",
            "room_code": room_code,
            "status": "CONTAINED_AND_VERIFIED",
            "simulation_mode": True,
            "duration_seconds": 30,
            "threat_summary": {
                "initial_vector": "Simulated Metadata Scan & Vault Exfiltration",
                "max_threat_score": 0.942,
                "classification": "High-Frequency Automated Intrusion",
                "plaintext_exposed": False,
                "zero_knowledge_boundary_intact": True
            },
            "exercised_protections": [
                "Strict Client-Side Encryption: Plaintext keys never stored in backend or database",
                "2-of-3 Threshold Approval: Cryptographic envelope resisted single-actor access attempt",
                "Metadata-Only Isolation Forest: Anomaly flagged within 1.2s without reading document content",
                "Granular Role Enforcement: Unauthenticated actor blocked from document read/write streams"
            ],
            "remediation_status": "Simulated threat safely neutralized. Production data unaffected."
        }
