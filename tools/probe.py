import json,subprocess,concurrent.futures,hashlib
from html.parser import HTMLParser
from pathlib import Path
urls=['https://smittenkitchen.com/2010/04/homemade-pop-tarts/','https://www.joshuaweissman.com/recipes/the-best-chocolate-chips-cookies-recipe-ever','https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/','https://www.simplyrecipes.com/recipes/banana_bread/','https://www.seriouseats.com/the-food-lab-best-chocolate-chip-cookie-recipe','https://www.bbcgoodfood.com/recipes/easy-pancakes','https://www.budgetbytes.com/creamy-tomato-spinach-pasta/','https://www.recipetineats.com/spaghetti-bolognese/','https://www.loveandlemons.com/banana-bread/','https://cookieandkate.com/best-lentil-soup-recipe/','https://sallysbakingaddiction.com/chewy-chocolate-chip-cookies/','https://www.kingarthurbaking.com/recipes/king-arthurs-original-cake-pan-cake-recipe']
class Parser(HTMLParser):
 def __init__(self): super().__init__(); self.active=False; self.buf=''; self.blocks=[]
 def handle_starttag(self,t,a):
  if t=='script' and dict(a).get('type','').lower()=='application/ld+json': self.active=True; self.buf=''
 def handle_data(self,d):
  if self.active:self.buf+=d
 def handle_endtag(self,t):
  if t=='script' and self.active:self.blocks.append(self.buf);self.active=False
 def recipes(self):
  def walk(x):
   if isinstance(x,dict):
    typ=x.get('@type',[]);typ=[typ] if isinstance(typ,str) else typ
    if 'Recipe' in typ:yield x
    for v in x.values():yield from walk(v)
   elif isinstance(x,list):
    for v in x:yield from walk(v)
  out=[]
  for b in self.blocks:
   try:out.extend(walk(json.loads(b)))
   except (ValueError,TypeError):pass
  return out

def probe(url):
 p=subprocess.run(['curl','-L','-sS','--max-time','35','-w','\n%{http_code}',url],capture_output=True,text=True)
 body,_,status=p.stdout.rpartition('\n'); h=Parser();h.feed(body)
 recipes=h.recipes(); summaries=[]
 def count(v):
  if isinstance(v,str):return int(bool(v.strip()))
  if isinstance(v,list):return sum(count(i) for i in v)
  if isinstance(v,dict):return count(v.get('itemListElement',v.get('text','')))
  return 0
 for r in recipes:summaries.append({'title':r.get('name'),'ingredients':count(r.get('recipeIngredient')),'steps':count(r.get('recipeInstructions'))})
 return {'url':url,'http':status,'sha256':hashlib.sha256(body.encode()).hexdigest(),'bytes':len(body.encode()),'recipes':summaries,'result':'structured_candidate' if any(r['ingredients'] and r['steps'] for r in summaries) and status=='200' else 'needs_browser_or_fallback','error':p.stderr[:200]}
if __name__=='__main__':
 results=list(concurrent.futures.ThreadPoolExecutor(max_workers=6).map(probe,urls));Path('site-probe-rerun.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))
