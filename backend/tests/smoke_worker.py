"""Run against the isolated local Worker documented in README; never calls AI."""

import concurrent.futures
import json
import urllib.error
import urllib.request
from uuid import uuid4

BASE = "http://127.0.0.1:8788"


def call(path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(BASE + path, headers=headers,
                                     data=json.dumps(body).encode() if body is not None else None)
    try:
        response = urllib.request.urlopen(request, timeout=60)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, json.load(response)


def main():
    assert call("/health")[0] == 200
    assert call("/api/me")[0] == 401
    status, login = call("/api/login", {"username": "demo", "password": "test-password"})
    assert status == 200, (status, login)
    token = login["token"]
    try:
        account = login["account"]
        assert account["config"]["enabled"] is False, "Use the isolated Worker with generation disabled"
        expected = account["user"]["balance"] + (0 if account["checkedIn"] else account["config"]["checkinReward"])
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: call("/api/checkin", {}, token), range(6)))
        assert all(status == 200 for status, _ in results), results
        status, account = call("/api/me", token=token)
        assert status == 200 and account["user"]["balance"] == expected, account
        assert account["checkedIn"]
        status, _ = call("/api/tasks", {"id": str(uuid4()), "prompt": "test", "size": "1328x1328"}, token)
        assert status == 403
    finally:
        assert call("/api/logout", {}, token)[0] == 200
    assert call("/api/me", token=token)[0] == 401
    username = "worker_" + uuid4().hex[:16]
    password = "worker-password-123"
    status, registered = call("/api/register", {"username": username, "password": password})
    assert status == 200, (status, registered)
    assert registered["account"]["user"]["balance"] == 0
    token = registered["token"]
    assert call("/api/checkin", {}, token)[1]["user"]["balance"] == registered["account"]["config"]["checkinReward"]
    assert call("/api/register", {"username": username.upper(), "password": password})[0] == 409
    assert call("/api/logout", {}, token)[0] == 200
    assert call("/api/login", {"username": username, "password": "wrong-password"})[0] == 401
    status, login = call("/api/login", {"username": username.upper(), "password": password})
    assert status == 200, (status, login)
    assert login["account"]["user"]["id"] == registered["account"]["user"]["id"]
    assert call("/api/logout", {}, login["token"])[0] == 200
    print("PASS: Worker Web Crypto password hashing, registration, duplicate username and login")
    print("PASS: Worker auth, D1 batch, concurrent checkins, generation switch and logout")


if __name__ == "__main__":
    main()
