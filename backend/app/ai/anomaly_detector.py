import numpy as np
from typing import Dict, Any, Tuple
from sklearn.ensemble import IsolationForest

class RoomAnomalyDetector:
    """
    Metadata-only Anomaly Detection Pipeline using scikit-learn Isolation Forest.
    
    Zero-Knowledge Guarantee:
    This detector operates strictly on rate and count metadata (frequencies, failures, export bursts).
    It NEVER receives or processes decrypted document text, passwords, or encryption keys.
    """
    def __init__(self, mode: str = "hybrid", contamination: float = 0.05):
        self.mode = mode  # "synthetic_demo", "real_baseline", or "hybrid"
        self.contamination = contamination

        # Baseline normal feature distributions:
        # [export_rate_per_min, auth_failures_per_min, request_rate_per_sec, perm_changes_per_min, sensitive_access_rate]
        normal_samples = np.array([
            [0, 0, 1.2, 0, 0],
            [0, 0, 0.5, 0, 0],
            [1, 0, 2.0, 0, 1],
            [0, 1, 1.5, 0, 0],
            [1, 0, 0.8, 0, 0],
            [0, 0, 3.1, 0, 0],
            [0, 0, 1.0, 1, 0],
            [2, 0, 1.8, 0, 1],
            [0, 0, 2.5, 0, 0],
            [1, 1, 1.1, 0, 0],
            [0, 0, 0.9, 0, 0],
            [0, 0, 2.2, 0, 1],
            [1, 0, 1.7, 0, 0],
            [0, 0, 1.4, 0, 0],
            [0, 0, 0.7, 0, 0],
        ], dtype=float)

        self.model = IsolationForest(
            contamination=self.contamination,
            random_state=42,
            n_estimators=50
        )
        self.model.fit(normal_samples)

    def extract_features(self, metrics: Dict[str, float]) -> np.ndarray:
        """
        Extract numerical metadata features:
        0: export_rate (exports/min)
        1: auth_failures (denied attempts/min)
        2: request_rate (requests/sec)
        3: perm_changes (role changes/min)
        4: sensitive_access (unlock requests/min)
        """
        export_rate = float(metrics.get("export_rate", 0))
        auth_failures = float(metrics.get("auth_failures", 0))
        request_rate = float(metrics.get("request_rate", 0))
        perm_changes = float(metrics.get("perm_changes", 0))
        sensitive_access = float(metrics.get("sensitive_access", 0))

        return np.array([[export_rate, auth_failures, request_rate, perm_changes, sensitive_access]], dtype=float)

    def evaluate_activity(
        self,
        metrics: Dict[str, float],
        is_simulated_demo: bool = False
    ) -> Dict[str, Any]:
        """
        Evaluate current activity metrics for anomalous behavior.
        Distinguishes clearly between real-baseline evaluations and synthetic demo modes.
        """
        features = self.extract_features(metrics)
        # raw decision function: lower means more abnormal
        raw_score = float(self.model.decision_function(features)[0])
        prediction = int(self.model.predict(features)[0])  # -1 = anomaly, 1 = normal

        # Normalize score into a 0.0 - 1.0 threat index (1.0 = extreme anomaly)
        # Decision function is typically in range [-0.5, 0.5]
        normalized_threat = max(0.0, min(1.0, 0.5 - raw_score))

        # Check dominant contributing signal
        feature_names = ["export_burst", "auth_failure_burst", "high_freq_flood", "privilege_tampering", "vault_exfiltration"]
        raw_vals = features[0]
        max_idx = int(np.argmax(raw_vals)) if np.max(raw_vals) > 0 else 0
        dominant_signal = feature_names[max_idx]

        is_anomaly = (prediction == -1) or (normalized_threat > 0.65) or is_simulated_demo

        severity = "info"
        if normalized_threat >= 0.85 or is_simulated_demo:
            severity = "critical"
        elif normalized_threat >= 0.70:
            severity = "alert"
        elif normalized_threat >= 0.50:
            severity = "warning"

        recommended_action = "none"
        if is_anomaly:
            if severity == "critical":
                recommended_action = "suspend_exports_and_prompt_mfa"
            elif severity == "alert":
                recommended_action = "rate_limit_and_alert_keyholders"
            else:
                recommended_action = "log_security_warning"

        return {
            "is_anomaly": is_anomaly,
            "threat_score": round(normalized_threat, 4),
            "severity": severity,
            "dominant_signal": dominant_signal,
            "recommended_action": recommended_action,
            "evaluation_mode": "synthetic_demo" if is_simulated_demo else "real_isolation_forest",
            "is_simulated": is_simulated_demo,
            "metrics_evaluated": {
                "export_rate": raw_vals[0],
                "auth_failures": raw_vals[1],
                "request_rate": raw_vals[2],
                "perm_changes": raw_vals[3],
                "sensitive_access": raw_vals[4]
            }
        }

anomaly_detector = RoomAnomalyDetector()
