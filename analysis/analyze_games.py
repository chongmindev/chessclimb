import chess, chess.pgn, chess.engine, json, sys

import os
SF = os.environ.get("STOCKFISH", "stockfish")
ME = "Dudacio"
eng = chess.engine.SimpleEngine.popen_uci(SF)
eng.configure({"Threads": 4, "Hash": 256})
LIM = chess.engine.Limit(depth=14)
VAL = {chess.PAWN:1, chess.KNIGHT:3, chess.BISHOP:3, chess.ROOK:5, chess.QUEEN:9, chess.KING:0}

def score_black(info):
    return info["score"].pov(chess.BLACK).score(mate_score=10000)

games = []
f = open(sys.argv[1])
while True:
    g = chess.pgn.read_game(f)
    if g is None: break
    h = g.headers
    if h["Black"] != ME: continue
    board = g.board()
    moves = list(g.mainline_moves())
    rec = dict(date=h["Date"], white=h["White"], welo=int(h["WhiteElo"]), belo=int(h["BlackElo"]),
               result=h["Result"], term=h["Termination"], nmoves=(len(moves)+1)//2,
               first=[board.san(moves[0])] , errors=[], castled=None, queen_early=0,
               my_moves=0, cpl_sum=0)
    b2 = board.copy(); sans=[]
    for m in moves[:4]:
        sans.append(b2.san(m)); b2.push(m)
    rec["opening"] = " ".join(sans)
    info = eng.analyse(board, LIM)
    for i, mv in enumerate(moves):
        movenum = i//2 + 1
        if board.turn == chess.BLACK:
            before = score_black(info)
            best = info.get("pv", [None])[0]
            best_san = board.san(best) if best else None
            san = board.san(mv)
            piece = board.piece_at(mv.from_square)
            if board.is_castling(mv) and rec["castled"] is None: rec["castled"] = movenum
            if piece.piece_type == chess.QUEEN and movenum <= 8: rec["queen_early"] += 1
            board.push(mv)
            info = eng.analyse(board, LIM)
            after = score_black(info)
            loss = max(0, min(before, 1000) - min(after, 1000)) if before > -1000 else 0
            rec["my_moves"] += 1; rec["cpl_sum"] += min(loss, 1000)
            # tag
            tag = None
            if loss >= 100:
                reply = info.get("pv", [None])[0]
                reply_san = board.san(reply) if reply else None
                hung = False
                if reply and board.is_capture(reply):
                    cap = board.piece_at(reply.to_square)
                    if cap and VAL[cap.piece_type] >= 3: hung = True
                missed_mate = before >= 9000 and after < 9000
                allowed_mate = after <= -9000 and before > -9000
                missed_win = before >= 300 and loss >= 200 and not missed_mate
                rec["errors"].append(dict(move=movenum, san=san, best=best_san, loss=loss,
                    before=before, after=after, reply=reply_san, hung=hung,
                    missed_mate=missed_mate, allowed_mate=allowed_mate,
                    piece=chess.piece_name(piece.piece_type), fen=board.fen()))
        else:
            board.push(mv)
            info = eng.analyse(board, LIM)
    games.append(rec)
    print(len(games), rec["result"], rec["opening"], len(rec["errors"]), file=sys.stderr)
eng.quit()
json.dump(games, open(sys.argv[2] if len(sys.argv)>2 else "analysis.json","w"), indent=1)
