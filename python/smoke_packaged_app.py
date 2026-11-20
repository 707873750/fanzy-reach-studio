"""Launch the packaged desktop app with an isolated empty user-data directory."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from playwright.sync_api import sync_playwright


def main():
    executable = Path(sys.argv[1]).resolve()
    if not executable.is_file():
        raise RuntimeError('Packaged application not found')
    with tempfile.TemporaryDirectory(prefix='fanzy-desktop-') as directory:
        profile = Path(directory) / 'profile'
        env = dict(os.environ)
        env.pop('ELECTRON_RUN_AS_NODE', None)
        env.pop('FANZY_PYTHON', None)
        process = subprocess.Popen([str(executable), '--remote-debugging-port=0', '--user-data-dir=' + str(profile)],
                                   env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            endpoint = profile / 'DevToolsActivePort'
            deadline = time.monotonic() + 30
            while not endpoint.is_file():
                if process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError('Packaged application failed to start')
                time.sleep(0.1)
            port = endpoint.read_text().splitlines()[0]
            with sync_playwright() as p:
                browser = p.chromium.connect_over_cdp('http://127.0.0.1:' + port)
                page = browser.contexts[0].pages[0]
                page.wait_for_function('window.reach && document.querySelector("#root")?.textContent.length > 100')
                assert page.evaluate('() => window.reach.listImages()') == []
                assert page.evaluate('() => window.reach.listDrafts()') == []
                logs = page.evaluate('() => window.reach.getLogs()')
                assert Path(logs['directory']).resolve().is_relative_to(profile.resolve()), logs['directory']
                assert not [entry for entry in logs['entries'] if entry.get('step') == 'renderer.error']
                page.close()
            if sys.platform == 'darwin':
                process.terminate()  # macOS apps remain alive after the last window closes.
            process.wait(timeout=15)
            print('PASS: packaged Electron app, renderer, preload IPC and isolated local store.')
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=15)


if __name__ == '__main__':
    main()
