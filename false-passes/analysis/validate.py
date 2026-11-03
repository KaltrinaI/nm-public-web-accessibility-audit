# Compares the authors' consensus ratings with the LLM verdicts and computes the stratified estimates.
import tempfile
# Usage: python validate.py <dir containing sample_full.json and ratings/>
import json,glob,os,collections,sys,math
from scipy.stats import binomtest
from sklearn.metrics import cohen_kappa_score, roc_auc_score
S=sys.argv[1]
key={r['id']:r for r in json.load(open(S+'/sample_full.json'))}
H={}
for f in glob.glob(S+'/ratings/*.json'):
    d=json.load(open(f)); d=d.get('data',d); H[d['item']]=d
rows=[]
for i,k in key.items():
    h=H[i]; r=dict(id=i,stratum=k['stratum'],kind=k['kind'],llm_fail=(k['llm_pass'] is False),llm_score=k.get('llm_score'),
                   imageType=k.get('imageType'),note=h.get('note') or '')
    if k['kind']=='image':
        r['role']=h.get('role'); r['h_fail']=None if h.get('role')=='not_loading' else (h.get('verdict')=='not_acceptable')
    else:
        r['alone_no']=h.get('alone')=='no'; r['ctx_no']=h.get('context')=='no'
    rows.append(r)
json.dump(rows,open(S+'/validation_rows.json','w'),ensure_ascii=False,indent=0)
def ci(k,n):
    if n==0: return ''
    c=binomtest(k,n).proportion_ci(method='exact'); return f'{100*k/n:.1f}% [{100*c.low:.1f}, {100*c.high:.1f}]'
def conf(pairs,label):
    tp=sum(1 for p,h in pairs if p and h); fp=sum(1 for p,h in pairs if p and not h)
    fn=sum(1 for p,h in pairs if not p and h); tn=sum(1 for p,h in pairs if not p and not h)
    n=len(pairs); prec=tp/(tp+fp) if tp+fp else float('nan'); rec=tp/(tp+fn) if tp+fn else float('nan')
    spec=tn/(tn+fp) if tn+fp else float('nan'); acc=(tp+tn)/n
    try: kap=cohen_kappa_score([p for p,_ in pairs],[h for _,h in pairs])
    except: kap=float('nan')
    print(f'{label}: n={n} TP={tp} FP={fp} FN={fn} TN={tn} prec={prec:.3f} rec={rec:.3f} spec={spec:.3f} acc={acc:.3f} kappa={kap:.3f}')
    return dict(n=n,tp=tp,fp=fp,fn=fn,tn=tn,prec=prec,rec=rec,spec=spec,acc=acc,kappa=kap)
R={}
img=[r for r in rows if r['kind']=='image']
nl=[r for r in img if r['h_fail'] is None]; print('not loading',len(nl),[r['id'] for r in nl])
iv=[r for r in img if r['h_fail'] is not None]
print('roles',collections.Counter(r['role'] for r in img))
for s in ['IMG-F30','IMG-TEXT','IMG-EMPTY']:
    g=[r for r in iv if r['stratum']==s]; k=sum(r['h_fail'] for r in g)
    print(s,'n',len(g),'human fail',k,ci(k,len(g)),'llm fail',sum(r['llm_fail'] for r in g), 'roles',collections.Counter(r['role'] for r in g))
    R[s]=conf([(r['llm_fail'],r['h_fail']) for r in g],s)
R['IMG-ALL']=conf([(r['llm_fail'],r['h_fail']) for r in iv],'images all')
R['IMG-JUDG']=conf([(r['llm_fail'],r['h_fail']) for r in iv if r['stratum']!='IMG-F30'],'images non-pattern')
lg=[r for r in iv if r['imageType']=='logo' and r['stratum']=='IMG-TEXT']; print('logos text', len(lg),'human fail',sum(r['h_fail'] for r in lg),'llm fail',sum(r['llm_fail'] for r in lg))
sc=[(r['llm_score'],r['h_fail']) for r in iv if r['stratum'] in('IMG-TEXT','IMG-F30') and r['llm_score'] is not None]
print('AUC score (non-empty alt)', roc_auc_score([h for _,h in sc],[-s for s,_ in sc]))
best=None
for t in range(0,101,5):
    pairs=[(s<t,h) for s,h in sc]
    tp=sum(1 for p,h in pairs if p and h); fp=sum(1 for p,h in pairs if p and not h); fn=sum(1 for p,h in pairs if not p and h); tn=len(pairs)-tp-fp-fn
    kap=cohen_kappa_score([p for p,_ in pairs],[h for _,h in pairs]) if 0<tp+fp<len(pairs) else 0
    acc=(tp+tn)/len(pairs)
    if best is None or kap>best[1]: best=(t,kap,acc,tp,fp,fn,tn)
print('best threshold',best)
ln=[r for r in rows if r['kind']=='link']
for s in ['LNK-F84','LNK-FAIL','LNK-PASS']:
    g=[r for r in ln if r['stratum']==s]
    print(s,len(g),'alone_no',sum(r['alone_no'] for r in g),'ctx_no',sum(r['ctx_no'] for r in g),'llm fail',sum(r['llm_fail'] for r in g))
R['LNK-CTX']=conf([(r['llm_fail'],r['ctx_no']) for r in ln],'links vs 2.4.4 (context)')
R['LNK-ALONE']=conf([(r['llm_fail'],r['alone_no']) for r in ln],'links vs 2.4.9 (alone)')
R['LNK-CTX-nonpattern']=conf([(r['llm_fail'],r['ctx_no']) for r in ln if r['stratum']!='LNK-F84'],'links nonpattern ctx')
f84=[r for r in ln if r['stratum']=='LNK-F84']; print('F84 human alone_no',sum(r['alone_no'] for r in f84),'/',len(f84),' ctx_no',sum(r['ctx_no'] for r in f84))
# stratified population estimates with 95% CI (population sizes = pool sizes in build_sample.py)
POP={'IMG-TEXT':481,'IMG-EMPTY':319,'IMG-F30':118,'LNK-PASS':4143,'LNK-FAIL':1572,'LNK-F84':442}
def strat(groups,fn):
    N=sum(POP[s] for s in groups); est=0; var=0
    for s in groups:
        g=[fn(r) for r in rows if r['stratum']==s and fn(r) is not None]; n=len(g); p=sum(g)/n; W=POP[s]/N
        est+=W*p; var+=W*W*p*(1-p)/n*(1-n/POP[s])
    se=math.sqrt(var); return round(100*est,1), round(100*(est-1.96*se),1), round(100*(est+1.96*se),1)
IMG=['IMG-TEXT','IMG-EMPTY','IMG-F30']; LNK=['LNK-PASS','LNK-FAIL','LNK-F84']
R['est_img_image_level']=strat(IMG,lambda r: None if r['kind']!='image' or r['h_fail'] is None else (r['h_fail'] and not (r['stratum']=='IMG-EMPTY' and r['role']=='functional')))
R['est_img_all']=strat(IMG,lambda r: None if r['kind']!='image' else r['h_fail'])
R['est_lnk_AA']=strat(LNK,lambda r: r['ctx_no'] if r['kind']=='link' else None)
R['est_lnk_AAA']=strat(LNK,lambda r: r['alone_no'] if r['kind']=='link' else None)
R['est_lnk_llm_flagged']=strat(LNK,lambda r: r['llm_fail'] if r['kind']=='link' else None)
for k in ('est_img_image_level','est_img_all','est_lnk_AA','est_lnk_AAA','est_lnk_llm_flagged'): print(k, R[k])
json.dump(R,open(S+'/validation_results.json','w'),indent=1,default=float)
