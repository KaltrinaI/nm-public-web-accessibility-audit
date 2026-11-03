# Draws the stratified 200-element validation sample (fixed seed 20261013).
# Usage: python build_sample.py <reports dir> <output dir>
import tempfile
import json,glob,random,sys,collections,re,os
from urllib.parse import urljoin
HERE=os.path.dirname(os.path.abspath(__file__))
REPORTS=sys.argv[1]; OUTDIR=sys.argv[2]
sys.argv=['x',REPORTS,tempfile.mkdtemp()]; exec(open(os.path.join(HERE,'analyze.py'),encoding='utf8').read().split('IMG_RULES =')[0])
IMG_RULES={'image-alt','role-img-alt','image-redundant-alt','link-name'}
pools=collections.defaultdict(list)
for f in sorted(glob.glob(REPORTS+'/*.json')):
  j=json.load(open(f)); h=j['homepage']; page=h['url']
  vn=[x['html'] for v in h['axe']['violations'] if v['id'] in IMG_RULES for x in v['nodes']]
  for it in h['modules']['images']['items']:
    a=it.get('alt'); src=it.get('src') or ''
    if a is None or it.get('pass') is None or it.get('skipped') or src.startswith('data:'): continue
    b=base(src)
    if b and any(b in x for x in vn): continue
    rec=dict(kind='image',page=page,src=urljoin(page,src),alt=a,llm_pass=it['pass'],llm_score=it.get('score'),imageType=it.get('imageType'))
    if not a.strip(): pools['IMG-EMPTY'].append(rec)
    elif img_rule(a): rec['pattern']=img_rule(a); pools['IMG-F30'].append(rec)
    else: pools['IMG-TEXT'].append(rec)
  for it in h['modules']['links']['items']:
    if it.get('skipped') or it.get('pass') is None: continue
    rec=dict(kind='link',page=page,text=' '.join(it['text'].split()),href=it.get('href'),context=' '.join((it.get('context') or '').split())[:320],llm_pass=it['pass'],llm_score=it.get('score'))
    r=link_rule(it['text'])
    if r: rec['pattern']=r; pools['LNK-F84'].append(rec)
    elif it['pass']: pools['LNK-PASS'].append(rec)
    else: pools['LNK-FAIL'].append(rec)
print({k:len(v) for k,v in pools.items()})
N={'IMG-TEXT':70,'IMG-EMPTY':50,'IMG-F30':20,'LNK-FAIL':25,'LNK-PASS':25,'LNK-F84':10}
rng=random.Random(20261013)
items=[]
for k,n in N.items():
  pool=pools[k]
  # dedupe by (src or text+href) per page to avoid identical items
  seen=set(); uniq=[]
  for r in pool:
    key=(r['page'],r.get('src') or (r['text'],r['href']))
    if key in seen: continue
    seen.add(key); uniq.append(r)
  for r in rng.sample(uniq,n): r['stratum']=k; items.append(r)
rng.shuffle(items)
for i,r in enumerate(items): r['id']=f'E{i+1:03d}'
json.dump(items,open(os.path.join(OUTDIR,'sample_full.json'),'w'),ensure_ascii=False,indent=0)
pub=[{k:r[k] for k in ('id','kind','page','src','alt','text','href','context') if k in r} for r in items]
json.dump(pub,open(os.path.join(OUTDIR,'sample_public.json'),'w'),ensure_ascii=False,separators=(',',':'))
print(len(items), collections.Counter(r['stratum'] for r in items))
