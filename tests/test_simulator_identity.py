from __future__ import annotations

import sys
import tempfile
import unittest
import base64
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec


PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "coffee-terminal"))

from simulator_identity import SimulatorIdentity  # noqa: E402


class SimulatorIdentityTest(unittest.TestCase):
    def test_identity_is_persistent_and_signs_expected_protocol_message(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = SimulatorIdentity(root, "demo-01")
            nonce, proof = first.proof("bootstrap")
            second = SimulatorIdentity(root, "demo-01")

            self.assertEqual(first.serial_number, second.serial_number)
            self.assertEqual(first.public_key_pem, second.public_key_pem)
            self.assertEqual((root / ".identity" / "demo-01.pem").stat().st_mode & 0o777, 0o600)

            public_key = serialization.load_pem_public_key(first.public_key_pem.encode("ascii"))
            self.assertIsInstance(public_key, ec.EllipticCurvePublicKey)
            public_key.verify(
                base64.urlsafe_b64decode(proof + "=" * (-len(proof) % 4)),
                f"coffee-simulator-pairing:v1:bootstrap:{first.serial_number}:{nonce}".encode("utf-8"),
                ec.ECDSA(hashes.SHA256()),
            )


if __name__ == "__main__":
    unittest.main()
