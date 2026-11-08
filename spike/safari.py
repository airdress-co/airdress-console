#!/usr/bin/env python3
"""Safari on macOS for the renderer spike (SPEC-189 189-0.8), over safaridriver.

No dependencies (the owner's Mac has only the system Python 3.9): plain
WebDriver over urllib. Expects `serve.py` on 127.0.0.1:47950 and
`safaridriver -p 4444` running, with Safari's "Allow remote automation" on.
Prints one JSON document with every measurement.
"""
import json
import sys
import urllib.request

DRIVER = 'http://127.0.0.1:4444'
PAGES = 'http://127.0.0.1:47950/spike'
REPLAY_MS = int(sys.argv[1]) if len(sys.argv) > 1 else 30000


def call(method, path, body=None, timeout=180):
    req = urllib.request.Request(
        DRIVER + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={'content-type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read() or b'{}').get('value')


def run_async(sid, body, *args):
    script = 'const done = arguments[arguments.length - 1];' + body
    return call('POST', f'/session/{sid}/execute/async', {'script': script, 'args': list(args)})


def run(sid, body):
    return call('POST', f'/session/{sid}/execute/sync', {'script': body, 'args': []})


def open_page(sid, page):
    call('POST', f'/session/{sid}/url', {'url': f'{PAGES}/{page}'})
    for _ in range(200):
        if run(sid, "return '__spike' in window;"):
            return
    raise RuntimeError(f'{page} never exposed __spike')


def replay(sid, ms, scale=None):
    arg = 'undefined' if scale is None else str(scale)
    return run_async(sid, f'window.__spike.replay({ms}, {arg}).then(done);')


def main():
    sid = call('POST', '/session', {'capabilities': {'alwaysMatch': {'browserName': 'safari'}}})['sessionId']
    out = {'replayMs': REPLAY_MS}
    try:
        call('POST', f'/session/{sid}/timeouts', {'script': 600000, 'pageLoad': 120000})
        call('POST', f'/session/{sid}/window/rect', {'x': 0, 'y': 0, 'width': 1280, 'height': 900})
        out['ua'] = run(sid, 'return navigator.userAgent;')
        out['dpr'] = run(sid, 'return window.devicePixelRatio;')

        open_page(sid, 'network.html?n=300&seed=7')
        out['h300'] = {
            'meta': run(sid, 'const s = window.__spike; return {n: s.n, edges: s.edges, events: s.events, layoutMs: s.layoutMs, hash: s.hash};'),
            'fit': replay(sid, REPLAY_MS),
            'zoomed': replay(sid, REPLAY_MS, 1),
            'png': run_async(sid, 'window.__spike.exportPng().then(done);'),
            'csp': run(sid, 'return window.__spike.violations;'),
        }
        out['stability'] = run(sid, 'return window.__spike.stability();')

        levers = {}
        for n in (300, 1000, 3000):
            for opt in ('plain', 'nodash', 'cache', 'cache,nodash'):
                open_page(sid, f'network.html?n={n}&seed=7&opt={opt}')
                levers[f'{n} {opt}'] = replay(sid, 10000)
        out['levers'] = levers

        big = {}
        for n in (6000, 10000):
            open_page(sid, f'network.html?n={n}&seed=7&opt=cache,nodash')
            big[str(n)] = {'layoutMs': run(sid, 'return window.__spike.layoutMs;'), 'replay': replay(sid, 10000)}
        out['big'] = big

        presets = {}
        for fx in ('household', 'random'):
            for n in (300, 1000):
                for preset in ('columns', 'groups', 'free'):
                    open_page(sid, f'network.html?n={n}&seed=7&preset={preset}&opt=cache,nodash&fixture={fx}')
                    presets[f'{fx} {n} {preset}'] = {
                        'layoutMs': run(sid, 'return window.__spike.layoutMs;'),
                        'hash': run(sid, 'return window.__spike.hash;'),
                        'focus': run(sid, 'return window.__spike.focus();'),
                        'replay': replay(sid, 10000),
                    }
        out['presets'] = presets

        open_page(sid, 'cyto.html?n=300&seed=7')
        out['a300'] = {'replay': replay(sid, REPLAY_MS), 'csp': run(sid, 'return window.__spike.violations;')}
    finally:
        call('DELETE', f'/session/{sid}')
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()
