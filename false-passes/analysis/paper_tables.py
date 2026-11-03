# Statistics for Tables 2 and 3 of the False Passes paper.
import tempfile
# Usage: python paper_tables.py <reports dir> <analyze.py output dir>
import csv, json, glob, os, sys, collections, statistics as st
from statsmodels.stats.contingency_tables import mcnemar
from scipy.stats import binomtest, fisher_exact, mannwhitneyu
HERE = os.path.dirname(os.path.abspath(__file__))
REPORTS, RESULTS = sys.argv[1], sys.argv[2]
sys.argv = ['x', REPORTS, tempfile.mkdtemp()]; exec(open(os.path.join(HERE, 'analyze.py'), encoding='utf8').read().split('IMG_RULES =')[0])
I = list(csv.DictReader(open(os.path.join(RESULTS, 'images.csv'), encoding='utf8')))
L = list(csv.DictReader(open(os.path.join(RESULTS, 'links.csv'), encoding='utf8')))
T = lambda x: x == 'True'
def ci(k, n):
    c = binomtest(k, n).proportion_ci(method='exact'); return f'{100*k/n:.1f}% [{100*c.low:.1f}, {100*c.high:.1f}]'

print('== Table 2: documented failures detected by rule-based and hybrid evaluation ==')
G = []
for r in I:
    if r['altc'] == 'missing' and T(r['axe_fail']): G.append(('F65 missing alt', True, True))
    elif r['rule']: G.append((r['rule'], T(r['axe_fail']), T(r['axe_fail']) or T(r['ai_fail'] or 'False')))
for r in L:
    if r['rule']: G.append((r['rule'], False, T(r['ai_fail'] or 'False')))
byc = collections.defaultdict(lambda: [0, 0, 0])
for c, a, h in G: byc[c][0] += 1; byc[c][1] += a; byc[c][2] += h
for c, v in byc.items(): print(f'{c:18s} n={v[0]:4d}  rule-based {v[1]:4d} ({100*v[1]/v[0]:.1f}%)  hybrid {v[2]:4d} ({100*v[2]/v[0]:.1f}%)')
n = len(G); A = sum(a for _, a, _ in G); H = sum(h for *_, h in G)
b = sum(1 for _, a, h in G if a and not h); c = sum(1 for _, a, h in G if h and not a)
both = sum(1 for _, a, h in G if a and h); none = sum(1 for _, a, h in G if not a and not h)
print('all documented failures', n, '| rule-based', A, ci(A, n), '| hybrid', H, ci(H, n))
print('discordant pairs: hybrid only', c, '| rule-based only', b, '| exact McNemar p =', mcnemar([[both, b], [c, none]], exact=True).pvalue)
Gi = [g for g in G if not g[0].startswith('F84')]
ni = len(Gi); Ai = sum(a for _, a, _ in Gi); Hi = sum(h for *_, h in Gi)
bi = sum(1 for _, a, h in Gi if a and not h); cc = sum(1 for _, a, h in Gi if h and not a)
print('images only', ni, '| rule-based', Ai, ci(Ai, ni), '| hybrid', Hi, ci(Hi, ni), '| exact McNemar p =',
      mcnemar([[sum(1 for _, a, h in Gi if a and h), bi], [cc, sum(1 for _, a, h in Gi if not a and not h)]], exact=True).pvalue)

print('\n== Table 3: LLM verdicts on elements passed by the rule engine ==')
IMG_RULES = {'image-alt', 'role-img-alt', 'image-redundant-alt', 'link-name'}
g = collections.defaultdict(list); flag = collections.Counter(); logo = collections.Counter()
for f in sorted(glob.glob(REPORTS + '/*.json')):
    h = json.load(open(f))['homepage']
    vn = [x['html'] for v in h['axe']['violations'] if v['id'] in IMG_RULES for x in v['nodes']]
    for it in h['modules']['images']['items']:
        a = it.get('alt'); b_ = base(it.get('src'))
        if a is None or it.get('pass') is None or it.get('source') not in ('ai-evaluation', 'ai-decorative-check'): continue
        if b_ and any(b_ in x for x in vn): continue
        k = 'empty' if not a.strip() else ('F30' if img_rule(a) else 'text')
        g[k].append((it['score'], it['pass']))
        if k != 'empty': flag[(k, it.get('isGenericPlaceholder'))] += 1
        if k == 'text' and it.get('imageType') == 'logo': logo[it['pass']] += 1
for k, v in g.items():
    s = [x for x, _ in v]; print(f'images {k:6s} n={len(v)} LLM fail={sum(1 for _, p in v if p is False)} median={st.median(s)} quartiles={st.quantiles(s, n=4)}')
print('images F30 vs other non-empty alt:', mannwhitneyu([x for x, _ in g['F30']], [x for x, _ in g['text']]))
print('placeholder flag (group, flag): count', dict(flag)); print('logos with non-pattern alt text, LLM pass:', dict(logo))
gl = collections.defaultdict(list); lv = collections.defaultdict(list)
for f in sorted(glob.glob(REPORTS + '/*.json')):
    for it in json.load(open(f))['homepage']['modules']['links']['items']:
        if it.get('skipped') or it.get('pass') is None: continue
        k = 'F84' if link_rule(it['text']) else 'other'
        gl[k].append(it['score']); lv[k].append(it['pass'])
for k, v in gl.items(): print(f'links {k:5s} n={len(v)} LLM fail={sum(1 for p in lv[k] if p is False)} median={st.median(v)} quartiles={st.quantiles(v, n=4)}')
print('links F84 vs other:', mannwhitneyu(gl['F84'], gl['other']))
a_ = sum(1 for p in lv['F84'] if p is False); b2 = len(lv['F84']) - a_
c2 = sum(1 for p in lv['other'] if p is False); d = len(lv['other']) - c2
print('links Fisher exact (LLM fail, F84 vs other):', fisher_exact([[a_, b2], [c2, d]]))
