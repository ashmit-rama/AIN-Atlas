"""Offline test boundary, including when the developer later configures real ADC."""

import os
import socket

import pytest


@pytest.fixture(autouse=True)
def offline_environment(monkeypatch, tmp_path):
    # Avoid reading a workstation .env or resolving a developer's real model settings.
    monkeypatch.chdir(tmp_path)
    for key in list(os.environ):
        if key.startswith("ATLAS_") or key in {
            "GOOGLE_API_KEY",
            "GEMINI_API_KEY",
            "GOOGLE_APPLICATION_CREDENTIALS",
        }:
            monkeypatch.delenv(key, raising=False)
    # An accidental live SDK call must fail before contacting a remote service.
    connect = socket.socket.connect

    def offline_connect(sock, address):
        if sock.family in {socket.AF_INET, socket.AF_INET6}:
            raise AssertionError("Network access is disabled in the Atlas unit/integration suite")
        return connect(sock, address)

    monkeypatch.setattr(socket.socket, "connect", offline_connect)
