"""Tests for blob handling: SSRF guard, size limit, AV scan stub."""
import pytest
from brain2.knowledge.blobs import ssrf_check_url, BlobStore, BlobTooLarge, AVScanFailed
from brain2.errors import SSRFBlocked


def test_ssrf_blocks_loopback():
    with pytest.raises(SSRFBlocked):
        ssrf_check_url("http://127.0.0.1/secret")


def test_ssrf_blocks_private_10():
    with pytest.raises(SSRFBlocked):
        ssrf_check_url("http://10.0.0.1/internal")


def test_ssrf_blocks_private_192():
    with pytest.raises(SSRFBlocked):
        ssrf_check_url("http://192.168.1.1/admin")


def test_ssrf_blocks_link_local():
    with pytest.raises(SSRFBlocked):
        ssrf_check_url("http://169.254.169.254/metadata")


def test_ssrf_allows_public():
    ssrf_check_url("http://203.0.113.1/resource")  # TEST-NET-3, numeric, should pass


def test_blob_store_upload_and_retrieve():
    store = BlobStore()
    blob_id = store.upload(b"hello world", filename="test.txt")
    data = store.retrieve(blob_id)
    assert data == b"hello world"


def test_blob_store_rejects_oversized():
    store = BlobStore(max_bytes=10)
    with pytest.raises(BlobTooLarge):
        store.upload(b"x" * 20, filename="big.txt")


def test_av_scan_rejects_eicar():
    store = BlobStore()
    eicar = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
    with pytest.raises(AVScanFailed):
        store.upload(eicar, filename="virus.exe")
