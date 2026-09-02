"""Software-only device identity used by the desktop simulator.

This intentionally mirrors the signing boundary of a future secure element:
the onboarding code can ask for a proof, but never needs to manipulate raw
private-key bytes after the identity file has been created.  It is a
development simulator, not a replacement for hardware key protection.
"""
from __future__ import annotations

import base64
import json
import os
import secrets
import tempfile
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec


class SimulatorIdentity:
    def __init__(self, root: Path, instance_name: str) -> None:
        self.root = root / ".identity"
        self.instance_name = instance_name
        self.key_path = self.root / f"{instance_name}.pem"
        self.meta_path = self.root / f"{instance_name}.json"
        self.root.mkdir(parents=True, exist_ok=True)
        self._key, self.serial_number = self._load_or_create()

    def _load_or_create(self) -> tuple[ec.EllipticCurvePrivateKey, str]:
        if self.key_path.exists() and self.meta_path.exists():
            key = serialization.load_pem_private_key(self.key_path.read_bytes(), password=None)
            if not isinstance(key, ec.EllipticCurvePrivateKey) or not isinstance(key.curve, ec.SECP256R1):
                raise ValueError("模拟器软件身份密钥格式不受支持")
            meta = json.loads(self.meta_path.read_text(encoding="utf-8"))
            serial_number = str(meta.get("serialNumber") or "")
            if not serial_number.startswith("SIM-"):
                raise ValueError("模拟器软件身份序列号无效")
            return key, serial_number
        key = ec.generate_private_key(ec.SECP256R1())
        serial_number = f"SIM-{secrets.token_hex(8).upper()}"
        private_pem = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        self._atomic_write(self.key_path, private_pem, mode=0o600)
        self._atomic_write(
            self.meta_path,
            json.dumps({"serialNumber": serial_number, "kind": "SIMULATOR_SOFTWARE"}, ensure_ascii=False, indent=2).encode("utf-8") + b"\n",
            mode=0o600,
        )
        return key, serial_number

    @staticmethod
    def _atomic_write(path: Path, payload: bytes, *, mode: int) -> None:
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temporary, mode)
            os.replace(temporary, path)
        finally:
            if temporary.exists():
                temporary.unlink()

    @property
    def public_key_pem(self) -> str:
        return self._key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("ascii")

    def proof(self, purpose: str) -> tuple[str, str]:
        nonce = secrets.token_urlsafe(24)
        message = f"coffee-simulator-pairing:v1:{purpose}:{self.serial_number}:{nonce}".encode("utf-8")
        signature = self._key.sign(message, ec.ECDSA(hashes.SHA256()))
        return nonce, base64.urlsafe_b64encode(signature).decode("ascii").rstrip("=")
