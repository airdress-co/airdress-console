#!/usr/bin/env python3
"""Safari draw cost on a locked Mac (SPEC-189 189-0.8): no requestAnimationFrame,
so each frame is drawn synchronously with its raster forced (flush=1), on a
CPU-backed canvas (soft=1): a GPU canvas's read-back never returns while the
screen is locked. So the numbers are Safari's software raster, the
pessimistic case, not what an unlocked Mac's GPU canvas does.
Run beside serve.py and safaridriver, like safari.py. Prints JSON."""
import json
import safari

sid = safari.call('POST', '/session', {'capabilities': {'alwaysMatch': {'browserName': 'safari'}}})['sessionId']
out = {}
try:
    safari.call('POST', f'/session/{sid}/timeouts', {'script': 600000, 'pageLoad': 120000})
    safari.call('POST', f'/session/{sid}/window/rect', {'x': 0, 'y': 0, 'width': 1280, 'height': 900})
    out['ua'] = safari.run(sid, 'return navigator.userAgent;')
    out['dpr'] = safari.run(sid, 'return window.devicePixelRatio;')
    for fx in ('random', 'household'):
        for n in (300, 1000, 3000):
            for preset in ('columns', 'groups', 'free'):
                for opt in (['plain', 'cache,nodash'] if preset == 'columns' else ['cache,nodash']):
                    if fx == 'household' and opt == 'plain':
                        continue
                    safari.open_page(sid, f'network.html?n={n}&seed=7&preset={preset}&opt={opt}&fixture={fx}&flush=1&soft=1')
                    out[f'{fx} {n} {preset} {opt}'] = {
                        'meta': safari.run(sid, 'const s = window.__spike; return {layoutMs: s.layoutMs, hash: s.hash};'),
                        'bench': safari.run(sid, 'return window.__spike.bench(300);'),
                        'csp': safari.run(sid, 'return window.__spike.violations;'),
                    }
    safari.open_page(sid, 'network.html?n=300&seed=7')
    out['stability'] = safari.run(sid, 'return window.__spike.stability();')
finally:
    safari.call('DELETE', f'/session/{sid}')
print(json.dumps(out, indent=2))
