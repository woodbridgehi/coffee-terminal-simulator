"""Windows-only DPAPI helpers for release builds.

The development simulator keeps its existing portable files. Packaged
Windows builds opt into this module so credentials and the software identity
private key are encrypted for the current Windows user.
"""
from __future__ import annotations

import ctypes
import os
from ctypes import wintypes


DPAPI_PREFIX = b"CT-DPAPI-1\0"
CRYPTPROTECT_UI_FORBIDDEN = 0x1


class _DataBlob(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_byte)),
    ]


def secure_storage_enabled() -> bool:
    return os.name == "nt" and os.environ.get("COFFEE_TERMINAL_SECURE_SECRETS") == "1"


def protect(data: bytes) -> bytes:
    if os.name != "nt":
        raise OSError("Windows DPAPI 只在 Windows 上可用")
    source = ctypes.create_string_buffer(data)
    source_blob = _DataBlob(len(data), ctypes.cast(source, ctypes.POINTER(ctypes.c_byte)))
    output_blob = _DataBlob()
    crypt32 = ctypes.windll.crypt32
    if not crypt32.CryptProtectData(
        ctypes.byref(source_blob), None, None, None, None,
        CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(output_blob),
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output_blob.pbData, output_blob.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(output_blob.pbData)


def unprotect(data: bytes) -> bytes:
    if os.name != "nt":
        raise OSError("Windows DPAPI 只在 Windows 上可用")
    source = ctypes.create_string_buffer(data)
    source_blob = _DataBlob(len(data), ctypes.cast(source, ctypes.POINTER(ctypes.c_byte)))
    output_blob = _DataBlob()
    crypt32 = ctypes.windll.crypt32
    if not crypt32.CryptUnprotectData(
        ctypes.byref(source_blob), None, None, None, None,
        CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(output_blob),
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output_blob.pbData, output_blob.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(output_blob.pbData)


def protect_envelope(data: bytes) -> bytes:
    return DPAPI_PREFIX + protect(data)


def unprotect_envelope(data: bytes) -> bytes:
    if not data.startswith(DPAPI_PREFIX):
        return data
    return unprotect(data[len(DPAPI_PREFIX):])
