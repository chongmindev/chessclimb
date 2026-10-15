import chess, chess.pgn, chess.engine, json, random
random.seed(3)
import os, sys
SF=os.environ.get("STOCKFISH","stockfish")
eng=chess.engine.SimpleEngine.popen_uci(SF); eng.configure({"Threads":4,"Hash":256})
L=chess.engine.Limit(depth=13)
def cap(s): return max(-2000,min(2000,s))
f=open(sys.argv[1])
unsafe=[]; safe=[]
while (g:=chess.pgn.read_game(f)):
  h=g.headers; b=g.board(); moves=list(g.mainline_moves())
  info=eng.analyse(b,L)
  for i,mv in enumerate(moves):
    if b.turn==chess.BLACK:
      before=info["score"].pov(chess.BLACK).score(mate_score=10000)
      best=info.get("pv",[None])[0]; best_san=b.san(best) if best else None
      san=b.san(mv); mn=i//2+1
      b.push(mv)
      if b.is_game_over(): break
      info=eng.analyse(b,L)
      after=info["score"].pov(chess.BLACK).score(mate_score=10000)
      loss=max(0,cap(before)-cap(after)) if before>-1500 else 0
      cand=(mn>=3 and before>-300 and cap(before)-cap(after)>=250) or (mn>=8 and cap(before)-cap(after)<=25 and random.random()<0.3)
      if not cand: continue
      infos=eng.analyse(b,L,multipv=5) if cand else [info]
      ws=[(m["pv"][0], cap(m["score"].pov(chess.WHITE).score(mate_score=10000)), m["score"].pov(chess.WHITE).mate()) for m in infos if m.get("pv")]
      top=ws[0]
      base={"fen":b.fen(),"from":chess.square_name(mv.from_square),"to":chess.square_name(mv.to_square),
            "san":san,"move":mn,"opp":h["White"],"date":h["Date"].replace(".","-"),
            "result":h["Result"]}
      if loss>=250 and before>-300 and mn>=3:
        r=top[0]
        if not (b.is_capture(r) or b.gives_check(r)): 
          b_ok=False
        else: b_ok=True
        if b_ok:
          acc=[w for w in ws if w[1]>=top[1]-80 and w[1]>=-cap(before)+200]
          d=dict(base, kind="threat", accept=[w[0].uci() for w in acc],
                 accept_san=[b.san(w[0]) for w in acc], reply=b.san(r),
                 mate=top[2], better=best_san, swing=round(loss/100,1),
                 evb=round(cap(before)/100,1), eva=round(cap(after)/100,1))
          unsafe.append(d)
      elif loss<=25 and mn>=8 and -150<=after<=400 and top[1]<150:
        safe.append(dict(base, kind="safe", evb=round(cap(before)/100,1), eva=round(cap(after)/100,1),
                    reply=b.san(top[0])))
    else:
      b.push(mv); info=eng.analyse(b,L)
eng.quit()
random.seed(7); random.shuffle(safe)
safe=safe[:round(len(unsafe)*0.6)]
items=unsafe+safe
for i,it in enumerate(items): it["id"]=i
json.dump(items,open(sys.argv[2] if len(sys.argv)>2 else "items.json","w"))
print(len(unsafe),len(safe))
