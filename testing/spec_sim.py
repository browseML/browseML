# SPDX-License-Identifier: MIT OR Apache-2.0
#   python3 testing/spec_sim.py BANKML_BIN MODEL.gguf ORACLE.jsonl [MESSAGES.json ANSWER.txt]
#   (the browseML case: MESSAGES = the browseML prompt, ANSWER = what bankml generate wrote for it)
# Prompt-lookup speculative decoding, simulated on recorded answers: per verify step, the draft is the k tokens that
# followed the latest earlier occurrence of the last n tokens (in prompt + answer so far); accepted = the matching prefix.
# Cost model (measured on this laptop): one token written ≈ 1/3 s, one token read in a batch ≈ 1/7 s.
import json, subprocess, sys
B, M = sys.argv[1], sys.argv[2]
def tok(text, special=True):
    out = subprocess.run([B, "tokenize", M] + ([] if special else ["--no-special"]), input=text.encode(), capture_output=True).stdout.decode()
    return json.loads(out)["tokens"]
def prompt_tokens(messages):
    p = subprocess.run([B, "chat-template", M], input=json.dumps(messages).encode(), capture_output=True).stdout.decode()
    return tok(p)
def sim(ctx, ans, n=3, k=4, w1=1/3, wb=1/7):
    i, steps, acc_total, t_spec = 0, 0, 0, 0.0
    while i < len(ans):
        seq = ctx + ans[:i]
        draft = []
        if len(seq) >= n:
            key = seq[-n:]
            for j in range(len(seq) - n - 1, -1, -1):
                if seq[j:j + n] == key:
                    draft = seq[j + n:j + n + k]; break
        if not draft:
            t_spec += w1; i += 1; continue
        a = 0
        while a < len(draft) and i + a < len(ans) and draft[a] == ans[i + a]: a += 1
        steps += 1; acc_total += a
        t_spec += max(w1, (len(draft) + 1) * wb)   # the batch: the last real token + the draft
        i += a + 1
    return dict(tokens=len(ans), verify_steps=steps, accepted=acc_total, t_plain=len(ans) * w1, t_spec=t_spec)
cases = []
for l in open(sys.argv[3]):
    d = json.loads(l); cases.append((d["request"]["messages"], d["text"]))
if len(sys.argv) > 4:
    msgs = json.load(open(sys.argv[4])); cases.append((msgs, open(sys.argv[5]).read()))
tot = dict(tokens=0, accepted=0, t_plain=0, t_spec=0, verify_steps=0)
for msgs, text in cases:
    r = sim(prompt_tokens(msgs), tok(text, False))
    for kk in tot: tot[kk] += r[kk]
    print(f"{r['tokens']:4d} tokens · {r['verify_steps']:3d} drafts · {r['accepted']:3d} accepted · speed ×{r['t_plain']/r['t_spec']:.2f}")
print(f"all: {tot['tokens']} tokens, {tot['accepted']} accepted in {tot['verify_steps']} drafts · speed ×{tot['t_plain']/tot['t_spec']:.2f}")
