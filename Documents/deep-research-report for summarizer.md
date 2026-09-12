# How to Spend Three to Six LLM Calls for the Best Possible Answer

## Executive conclusion

The research points to a fairly clear practical answer to your original question:

> **For general-purpose analysis, research, and difficult open-ended questions, do not spend all of your extra calls extending one chain of thought. Start with multiple independent attempts, preserve their independence, and then use a later call to construct a new answer from the best parts.**

In other words, **breadth first, synthesis second, targeted correction third** is the strongest general-purpose pattern I found.

For a fixed budget of roughly three to six same-model calls, my recommended default is:

| Model-call budget | Best general-purpose pipeline | My confidence |
|---|---|---|
| **3 calls** | **2 independent answers → 1 fresh synthesis** | High |
| **4 calls** | **3 independent answers → 1 fresh synthesis** | **Very high** |
| **5 calls** | **3 independent answers → 1 disagreement/error audit → 1 final reconstruction** | **Very high** |
| **6 calls** | **3 independent answers → 2 independent specialized audits → 1 final reconstruction** | High |

The **four-call version has unusually direct experimental support**. A 2025 study called *Generative Self-Aggregation* compared methods under a fixed four-call budget. Its method generated **three independent responses and then used the fourth call to generate a better response from them**. Across mathematical reasoning, knowledge tasks, coding, and open-ended generation, this generally beat ordinary self-refinement and “choose the best of three” prompting, and often matched or exceeded four-sample self-consistency. citeturn16view7turn15view3

That result is particularly relevant because it is almost exactly the experiment you originally proposed.

The crucial distinction is that the fourth model should **not merely vote or choose which answer looks best**. It should **generate a new answer after studying the candidates**. In the Generative Self-Aggregation experiments, this generative aggregation strategy outperformed “choose-from-N”; the authors even observed cases where the synthesis produced a correct answer although **none of the three inputs was fully correct**. citeturn16view7

There are important exceptions. For math or multiple-choice questions with a clean answer, ordinary **independent sampling plus majority voting** is extremely strong. For code, the best use of extra compute changes because tests provide an external correctness signal: generate alternatives, run them, and spend subsequent calls repairing the most promising candidate from test feedback. For writing or highly subjective work, sequential critique/revision becomes more attractive because the problem is often not “discover the one correct answer” but “improve an existing artifact against a rubric.” citeturn20view0turn21view11turn22view0

Most importantly, **repeated follow-up questions are not automatically equivalent to additional independent reasoning**. Once call two sees call one's answer, it is no longer an independent sample. It can inherit the original framing, assumptions, and mistakes. Recent experiments on homogeneous same-model debate show extreme versions of this effect: agents exposed to peers can converge strongly on the majority answer even when a correct answer already exists elsewhere in the group. citeturn21view8turn21view10

So if your actual choice is:

> **“Run three independent versions and combine them”**

versus

> **“Generate one answer and keep asking the model to reconsider it”**

my default choice is **independent versions first**.

Then, if you have enough budget, add **one targeted correction stage after synthesis**.

## What the evidence says about the competing strategies

The literature is easier to understand if we separate three things that are often lumped together as “more reasoning”:

**Exploration** means generating genuinely different candidate solutions.

**Verification** means determining which claims, steps, or candidates are actually correct.

**Refinement** means turning what you have learned into a better final answer.

More inference does not help equally at all three. The strongest recurring lesson across the literature is that LLMs are often better at **generating another possibility** than at accurately **judging whether their own existing possibility is wrong**. citeturn21view1turn16view7turn22view2

### Independent samples and self-consistency

The foundational evidence for breadth is Google's self-consistency work. Instead of taking one chain of thought, the model samples many independent reasoning paths and chooses the answer reached most consistently. On the models studied, this produced absolute gains of **17.9 points on GSM8K, 11.0 on SVAMP, 12.2 on AQuA, 6.4 on StrategyQA, and 3.9 on ARC-Challenge**. citeturn20view0

The underlying principle matters more than those older benchmark numbers: **introducing diversity into the reasoning paths can rescue an answer that greedy decoding misses**. The study described self-consistency as effectively a “self-ensemble” of one model. citeturn20view0

Repeated sampling also scales the probability that at least one candidate is correct. *Large Language Monkeys* demonstrated this across enormous sampling ranges. In software engineering, DeepSeek-Coder-V2-Instruct went from solving **15.9% of SWE-bench Lite issues with one sample to 56% with 250 samples** when candidate outputs could ultimately be verified. citeturn21view6

But this introduces a major distinction:

> **Generating the correct answer somewhere in the candidate pool and knowing which candidate is correct are two different problems.**

On problems without automatic verification, majority voting and reward-model selection eventually plateaued in the *Large Language Monkeys* experiments even though additional sampling continued expanding the candidate space. citeturn21view7

A 2026 general-agent study found the same basic phenomenon at much smaller sampling scales: parallel sampling increased the number of problems for which a successful trajectory existed, but the agent often could not reliably **self-select that trajectory**. The authors call this the **verification gap**. citeturn15view1

This is one reason I would not recommend blindly doing:

> 5 answers → “Which one is best?”

unless the final judging call has good external evidence or an unusually strong rubric.

### Self-refinement and answer → critique → revision

There is real evidence for self-refinement, but it needs to be interpreted carefully.

The original *Self-Refine* paper used one LLM as generator, feedback provider, and refiner. Across seven tasks, it reported roughly **20% absolute average improvement**, with gains across dialogue, code optimization/readability, constrained generation, sentiment transformation, acronym generation, and some reasoning settings. citeturn22view0

That makes sequential refinement particularly plausible for outputs where the model can **inspect an artifact against explicit quality criteria**:

> “Does this answer satisfy all five requirements?”

> “Is this paragraph unclear?”

> “Can this implementation be simplified?”

> “Does the text violate the requested format?”

Those are different from asking:

> “Is my reasoning actually factually correct?”

Later work found the latter much harder. *Large Language Models Cannot Self-Correct Reasoning Yet* found that intrinsic self-correction without external feedback frequently failed to improve reasoning and could actually **degrade** correct answers. citeturn21view0turn21view1

A related study reached an especially useful conclusion: LLMs can often **repair a reasoning error when told where the error is**, but they are substantially worse at reliably locating the error themselves. Providing the gold mistake location produced meaningful correction gains, emphasizing that the bottleneck is often **diagnosis rather than rewriting**. citeturn21view3

Even the Self-Refine paper's later analysis illustrates the distinction. On its math task, ordinary Self-Refine barely moved GPT-3.5/ChatGPT/GPT-4, whereas giving it **oracle correctness information** improved the refinement results more substantially. citeturn23view0

A much newer agentic study, updated in August 2026, found a similar pattern. GPT-4.1's baseline score was 55.76; unconditional reflection actually lowered it slightly to 55.15. Reflection only on the most problematic steps increased it to 56.36. In other words, **“reflect everywhere” was worse than “reflect selectively.”** citeturn23view2turn23view5

So strategy B:

> **Answer → critique → revision**

is useful, but it is not the universal winner people sometimes assume it is.

Its weakness is simple: **if the critic has the same blind spot as the original solver, the critique doesn't introduce new information.**

### Best-of-N and judging candidates

Best-of-N is conceptually attractive:

> Generate several answers → ask the model which is best.

But candidate generation and candidate selection have very different difficulty profiles.

The four-call Generative Self-Aggregation study made this comparison unusually clean. It gave the same three candidates either to:

1. a **choose-from-N** model that selected one, or
2. an **aggregation** model that wrote a new solution after considering all three.

The aggregation method consistently beat the choose-from-N baseline across the tested models and tasks. citeturn16view7

For GPT-4o-mini, for example, the four-call aggregation procedure scored **78.25 on MATH versus 76.80 for choose-from-N**, **42.17 versus 38.39 on GPQA**, **85.11 versus 80.51 on MMLU**, **9.13 versus 8.84 on MT-Bench**, **55.85 versus 50.20 on AlpacaEval**, and **74.2 versus 72.6 on MBPP**. Plain self-refinement was also generally behind aggregation in those experiments. citeturn16view7

That is strong evidence for a practical prompt-design change:

> Don't ask the final call, **“Which answer is best?”**

Ask it:

> **“Use these as independent working drafts. Re-solve the problem yourself, preserve correct insights, resolve disagreements, discard unsupported claims, and produce a better answer than any individual draft.”**

This changes the final call from a **discriminator** into a **generator**, which appears to be a capability LLMs are often better at.

A 2026 paper on LLM juries reinforces the underlying concern. It found that a model scoring its **own** candidate solutions was a weak verifier, whereas independently trained models with decorrelated errors provided a much stronger selection signal. On a fixed best-of-N candidate pool, cross-model consensus outperformed self-consistency and single-model verification by as much as 20 points on AIME; the authors attributed the advantage to **error decorrelation**. citeturn22view2

That paper uses different models, whereas your constraint is the **same model**, so we cannot simply import its solution. But it gives us a useful design principle: **your real asset is diversity of errors, not the number of calls itself**. Repeating the same model in contexts that make it reproduce the same misconception has very little ensemble value. citeturn22view2

### Parallel synthesis versus multi-agent debate

Early multi-agent debate work showed promising improvements when multiple LLM instances independently proposed answers and then exchanged arguments. That helped motivate a large literature on multi-agent deliberation. But later evidence suggests that **homogeneous same-model debate has a dangerous failure mode: communication can destroy the very diversity you paid to generate**.

A particularly relevant 2026 study compared homogeneous teams of Qwen2.5-7B, Llama-3.1-8B, and Ministral-3-8B on GSM-Hard and MMLU-Hard. On many conditions, private/isolated self-correction beat open debate. In one striking condition, Ministral's group contained a correct answer in **53%** of GSM-Hard cases, yet debate's final accuracy was only **20.7%**, creating a 32.3-point “oracle gap.” citeturn21view10

The authors measured very high rates of **modal sycophancy**—adopting the group's majority answer—including **85.5%** for Qwen on MMLU-Hard. They also found evidence for primacy effects: agents disproportionately followed the first/high-confidence peer they saw. citeturn21view8

This should not be read as “all multi-agent systems are bad.” The experiment used particular 7–8B open-weight models, prompts, team structures, and benchmarks. But it is directly relevant to your idea of repeatedly showing the same model its previous answers.

The safer pattern is:

**Independent work → controlled comparison → final synthesis**

rather than:

**Answer A → B sees A → C sees A+B → D sees everything → everyone converges.**

That first structure preserves diversity until diversity has served its purpose.

This principle also appears in production research systems. Anthropic describes its research architecture as parallel subagents operating with separate contexts and exploration trajectories, explicitly noting that the separation reduces path dependence; the lead agent synthesizes their findings afterward. Their internal evaluation found particularly large benefits on breadth-first research tasks, although their system uses different Claude model tiers and far more than your three-to-six-call budget, so it is supporting engineering evidence rather than a controlled same-model experiment. citeturn13view1

## Why parallel-first usually beats repeatedly following up

Your original question can be reframed as a choice between **breadth** and **depth**.

Suppose call one gives the wrong answer because it adopts assumption \(A\).

In a sequential pipeline:

**Call 1:** adopts A → answer  
**Call 2:** reads answer containing A → critiques within that frame  
**Call 3:** reads answer + critique → improves presentation while retaining A

You have spent three calls, but all three reasoning trajectories may effectively live on the same branch.

In a parallel pipeline:

**Call 1:** independently adopts A  
**Call 2:** independently adopts B  
**Call 3:** independently notices C

Now the downstream model can see an actual disagreement.

That doesn't guarantee correctness, but it creates **information that did not exist in the linear chain**.

This is precisely what self-consistency exploits: diversity among sampled reasoning paths is valuable because errors are not always identical across samples. citeturn20view0

And recent work on generative aggregation provides direct evidence that the downstream model can sometimes combine useful pieces of several imperfect answers into something better than merely choosing among them. citeturn16view7

### The catch: same-model independence is only partial

Three instances of the same LLM are not equivalent to three genuinely independent experts.

They share:

- training data,
- learned representations,
- systematic misconceptions,
- safety/alignment behavior,
- default problem-solving heuristics,
- and often similar high-probability generations.

The cross-model jury results show why this matters: error **decorrelation** was the important ingredient, and resampling one model continued to inherit that model's systematic errors. citeturn22view2

Therefore, merely doing:

> same exact prompt × 3 at temperature ≈ 0

may provide disappointingly little diversity.

On the other hand, deliberately making sampling more diverse can help. In the Generative Self-Aggregation ablations, very low temperature reduced candidate diversity and performance; raising temperature initially helped until excessive randomness began lowering candidate quality. The study also obtained similar results by varying prompt templates rather than relying exclusively on stochastic sampling. citeturn16view7

So I would distinguish two concepts:

**Independent context** is almost always desirable early.

**Identical wording** is not necessarily desirable.

For serious analysis, I would keep the **question and success criteria identical** while varying the requested reasoning approach slightly.

For example:

> Candidate A: solve from first principles and produce your best overall analysis.

> Candidate B: independently solve the same problem, emphasizing counterarguments, failure modes, and assumptions that a first analyst might overlook.

> Candidate C: independently solve it with an evidence-first approach; identify what would have to be true for each major conclusion to hold.

That is an inference from the diversity results rather than a universally benchmarked recipe, but it should give you more useful variance than three low-temperature copies whose reasoning is nearly identical. citeturn16view7turn22view2

### Where depth becomes valuable

Breadth should not be interpreted as “never refine.”

The newer test-time-scaling literature increasingly suggests that the real optimum is **breadth plus depth**, not one or the other.

*Wider or Deeper?* introduced Adaptive Branching MCTS, which dynamically chooses between generating another independent solution and refining an existing candidate using external feedback. On complex coding, engineering, and ARC-AGI tasks it outperformed repeated sampling under matched compute budgets. citeturn21view11turn21view12

A very recent August 2026 preprint, *Refining Over Resampling*, goes further for mathematical reasoning. Its approach first samples independent trajectories and then refines them through self-critique/self-correction before majority aggregation. Across AIME24, AIME25, AMC, OlympiadBench, and MATH500, the authors report improvements over pure majority voting and verifier-based best-of-N across several open-weight models. It is particularly interesting because it explicitly combines **breadth and depth**, but it is a new preprint submitted to EMNLP 2026 rather than mature, replicated evidence, so I would treat it as a promising update rather than overturning the broader self-correction literature. citeturn17view0

The emerging picture is therefore:

> **Explore first. Refine when you have evidence about what deserves refinement.**

That is significantly different from:

> **Generate one answer and automatically spend every remaining call reconsidering it.**

Snell et al.'s test-time-scaling work points in the same direction: the most efficient allocation depends strongly on **question difficulty**, and an adaptive compute strategy was more than four times as compute-efficient as naive best-of-N in their experimental setting. citeturn21view4turn21view5

So there probably is no globally optimal fixed pipeline—but there is a very good default architecture.

## How the optimal strategy changes by task

This is where a single recommendation becomes misleading. Different tasks have very different verification structures.

| Task | Best use of extra calls | Avoid |
|---|---|---|
| **Math / closed-answer reasoning** | Independent solutions + majority/verification; optionally refine divergent candidates | Repeated generic self-critique |
| **Factual questions** | Independent retrieval/evidence gathering + fact audit + synthesis | Voting on unsupported model memory |
| **Coding** | Independent implementations + execution/tests + feedback-driven repair | LLM judging code by appearance alone |
| **Deep research** | Parallel source/research branches + synthesis + citation/fact audit | Several agents all searching the same path |
| **Business/strategic analysis** | Independent perspectives + adversarial audit + synthesis | Early debate that pushes premature consensus |
| **Writing / style / formatting** | Draft → rubric critique → revision can be excellent | Spending most calls on independent drafts when requirements are already clear |
| **Open-ended ideation** | Maximum parallel diversity, then synthesis | Majority voting, which suppresses unusual ideas |

### Mathematics and deterministic reasoning

For math, multiple independent reasoning paths have some of the strongest empirical support. Self-consistency was developed for exactly this regime and produced large gains over single-chain decoding. citeturn20view0

Here, **majority voting has a property synthesis does not need to have**: it cannot invent a new arithmetic mistake while combining otherwise-correct solutions.

Thus, if the final answer can be normalized programmatically and voting itself costs no LLM call:

> **3-call budget:** 3 independent solutions → majority  
> **5-call budget:** 5 independent solutions → majority

can be extremely sensible.

With four calls, I would use:

> 3 independent solutions → 1 verifier/re-solver focused specifically on disagreements

or:

> 3 solutions → generative aggregation

The four-call aggregation study found that three candidates plus synthesis matched or exceeded four-answer self-consistency on several structured benchmarks, although the exact winner varied by task/model. citeturn16view7

For six calls, the recent breadth-depth results make this interesting. A plausible high-accuracy configuration is:

> 3 independent solutions → independently refine each solution once → programmatic majority.

That allocates three calls to exploration and three to local repair. The August 2026 *Refining Over Resampling* results provide preliminary support for this type of breadth-depth reasoning architecture, but because it is extremely recent and not yet a broad consensus result, I would benchmark it against five-sample self-consistency on your actual math distribution. citeturn17view0

### Coding

Coding is almost the opposite of free-form analysis because **you frequently have a real external verifier**: compiler output, unit tests, type checking, static analysis, or execution results.

That changes everything.

Repeated sampling becomes valuable because it expands coverage, and automated tests largely solve the selection problem. *Large Language Monkeys* demonstrated enormous gains from repeated sampling in software engineering specifically because outputs could be verified. citeturn21view6

AB-MCTS likewise found that once external feedback exists, a system can profitably switch between generating new candidate implementations and refining promising ones. citeturn21view11turn21view12

For code I would therefore favor:

> **Generate independently → run tests → feed actual failures into refinement.**

Not:

> **Generate → ask the same model whether its code looks correct → revise.**

The latter throws away the strongest signal available.

### Factual questions

For factual questions, three outputs agreeing is weaker evidence than it appears.

The same model can reproduce the same learned misconception three times. Cross-model-consensus work demonstrates the general mechanism: correlated errors can turn consensus into false confidence. citeturn22view2

Thus for factual work, the most valuable additional “call” is often not another unaided answer. It is an answer forced to **retrieve or inspect independent evidence**.

A good factual pipeline is:

> independent answer/research branch A  
> independent evidence branch B  
> final synthesis that must reconcile every substantive disagreement against sources

With additional budget:

> add a claim-level fact checker before finalization.

For true deep research, parallelization is especially useful because different branches can search genuinely different areas. Anthropic reports that its research system deliberately uses separate subagent contexts and exploration trajectories to reduce path dependence before synthesis, and says its largest gains appeared on breadth-first research questions. citeturn13view1

### Research and complex analysis

This is the category I suspect matters most for what **you** are doing.

Here there is usually no single string that can be majority-voted. An excellent answer may combine:

- evidence discovered by analyst A,
- an objection raised by analyst B,
- a framework invented by analyst C.

That makes **generative aggregation** much more appropriate than self-consistency.

Anthropic's general engineering guidance similarly distinguishes voting-style parallelization from sectioning/orchestrator-worker patterns. It recommends parallel work when multiple perspectives are needed and describes orchestrator-worker synthesis as useful for complex tasks whose subtasks cannot be predicted cleanly in advance. citeturn13view0

Their production research architecture goes even further: parallel researchers operate independently, then a lead researcher synthesizes findings and decides whether further investigation is necessary. citeturn13view1

For your type of “tighten the analysis until it is as good as possible” workflow, I would copy **that structural principle**, scaled down to three-to-six calls.

### Writing, rewriting, and subjective quality

This is where sequential refinement deserves more credit.

If there is already a basically correct draft and your remaining objective is:

- clarity,
- organization,
- tone,
- concision,
- formatting,
- meeting constraints,
- persuasive strength,

then the output itself contains most of the information needed to improve it.

Self-Refine showed substantial gains precisely on several such tasks. citeturn22view0

Therefore, for a writing task I might prefer:

> Draft → rubric-based critique → revision

over:

> Draft A + Draft B → synthesis.

And at five calls:

> draft → structural critique → revision → line-level critique → final polish

can make sense.

The key distinction is **error discovery versus artifact improvement**.

LLMs appear more reliable at saying “this paragraph is repetitive and does not meet criterion three” than at saying “my internal factual premise from two turns ago is actually false.” The contrasting Self-Refine and intrinsic self-correction findings support that distinction. citeturn22view0turn21view1

## The best pipelines for three, four, five, and six calls

Here is the part I would actually operationalize.

### Three-call budget

For **general analysis, research, recommendations, strategic reasoning, and open-ended questions**:

**Call A — independent solution**

> Produce your best answer from scratch. Identify assumptions, evidence, uncertainties, and the strongest conclusion.

**Call B — independent alternative**

Crucially, **do not show it Call A**.

> Solve the same task independently. Look especially for alternative interpretations, missing considerations, counterarguments, and failure modes.

**Call C — generative synthesis**

Give it A and B.

> Produce a new answer to the original question using these independent analyses as working material. Do not simply select one. Re-evaluate the problem yourself, reconcile disagreements, preserve the strongest supported insights from each, discard unsupported claims, and produce an answer better than either candidate.

This is my **three-call default**.

I prefer it over:

> answer → critique → revision

for difficult general reasoning because independent sampling gives the system a second opportunity to escape the first answer's framing before convergence begins. Self-consistency and generative-aggregation evidence support the value of that diversity, while intrinsic self-correction studies warn that a critique generated from the same underlying information can preserve or even worsen reasoning errors. citeturn20view0turn21view1turn15view3

For **writing/editing**, switch to answer → critique → revision.

For **closed-answer math**, use three independent samples → programmatic majority when possible.

### Four-call budget

This is the **sweet spot** I would test first.

> **Call A:** independent analysis  
> **Call B:** independent analysis  
> **Call C:** independent analysis  
> **Call D:** generative synthesis

This corresponds almost directly to the Generative Self-Aggregation setup whose four-call budget outperformed Self-Refine and choose-from-N across numerous tested settings. citeturn16view7

The important prompt instruction for D is:

> **You are not a judge selecting one candidate. You are the final solver.**

I would explicitly tell D to create a **new solution**.

For example:

> “The following are three independent attempts at the same problem. Treat them as fallible research notes, not authoritative answers. Solve the original problem yourself using whatever is correct and useful from them. Explicitly resolve substantive disagreements. Do not adopt a claim merely because two drafts repeat it. Produce the most accurate, complete, well-supported final answer possible.”

That last sentence—**do not adopt something merely because it appears repeatedly**—is intended to counter correlated same-model errors and social/majority anchoring, both of which are real concerns in the literature. citeturn22view2turn21view8

Among your original choices, **A is therefore my winner at four calls**, with one modification:

> **3 independent answers → generative reconstruction**

rather than merely “combine the outputs.”

### Five-call budget

At five calls, I would **not** simply generate a fourth independent draft.

I would introduce a different operation:

> **A:** independent solution  
> **B:** independent solution  
> **C:** independent solution  
> **D:** audit the candidate set  
> **E:** write final answer from scratch using candidates + audit

But Call D should not be a vague:

> “Critique these answers.”

Make it an **error-finding and disagreement-analysis call**.

For example:

> “Do not write the final answer. Audit these three analyses. Build a disagreement map. Identify factual claims needing verification, logical steps that do not follow, assumptions shared by all three that might nevertheless be wrong, important omissions, and conclusions for which the evidence is weak. For each disagreement, state what evidence or reasoning would resolve it.”

Then Call E receives the original problem, A/B/C, and D.

> “Produce the final answer. Use the audit to repair weaknesses, but independently decide whether each criticism is valid. Do not blindly follow either the candidate majority or the critic.”

I regard this as stronger than your original **D: 3 answers → judge → final revision**, because “judge” invites the model to select a winner. Research increasingly suggests **selection is a bottleneck**. An audit gives the final generator richer information without forcing the preceding call to make a brittle all-or-nothing choice. citeturn16view7turn15view1turn22view2

So my preferred five-call architecture is:

> **3 explore + 1 diagnose + 1 reconstruct**

rather than:

> **1 answer + 2 cycles of self-criticism**

except for writing/style tasks.

### Six-call budget

My default for high-value analysis would be:

> **A:** independent primary analysis  
> **B:** independent alternative analysis  
> **C:** independent skeptical analysis  
> **D:** factual/evidence audit  
> **E:** reasoning/completeness/counterargument audit  
> **F:** final generative synthesis

Calls D and E should be **independent of one another** where practical. They both see A/B/C, but not each other's audits.

That preserves another small amount of diversity.

I would specialize them:

**Audit D — correctness**

> Check factual assertions, mathematical/logical steps, causal claims, source support, contradictions, and unsupported certainty.

**Audit E — completeness**

> Look for missing interpretations, ignored alternatives, confounders, counterarguments, decision-relevant factors, and ways in which all three analyses share the same blind spot.

Then F sees everything and writes from scratch.

This creates:

\[
\text{3 exploration calls} +
\text{2 verification perspectives} +
\text{1 integration call}
\]

which is the best six-call **general analytical pipeline** I can justify from the combined evidence.

The exact 3+2+1 configuration has not, to my knowledge from the reviewed literature, been established as a universal optimum in a controlled benchmark. It is my synthesis of several findings: independent sampling increases useful coverage; generative aggregation is stronger than simple self-selection in direct four-call experiments; same-model verification is imperfect; multiple focused considerations can outperform packing every consideration into one call; and prolonged interconnected debate risks destroying initial diversity. citeturn20view0turn16view7turn13view0turn21view10

For math, coding, or other objectively verifiable tasks, I would alter the six-call allocation rather than using this general pipeline.

## How I would rank the strategies you originally proposed

Your original A–E choices become much clearer in light of the evidence.

| Strategy | Calls | General analysis | Objective reasoning | Writing/style | Main issue |
|---|---:|---:|---:|---:|---|
| **A. 3 independent → synthesis** | 4 | **Excellent** | Excellent | Excellent | Synthesis must resist majority anchoring |
| **B. Answer → critique → revision** | 3 | Good | **Mixed** | **Excellent** | Critic may share original error |
| **C. 2 independent → judge → synthesis** | 4 | Very good | Good | Very good | One call spent on potentially weak self-judgment |
| **D. 3 independent → judge → final revision** | 5 | **Excellent if “judge” becomes auditor** | Very good | Excellent | Selection can bottleneck |
| **E. Answer → critique → revision → critique → revision** | 5 | Good | Mixed | **Excellent** | Increasing anchoring/context dependence |

For **your stated goal—“tighten up the best analysis/output” rather than solve only arithmetic problems—my ordering is roughly:**

> **D-modified ≳ A > C > B/E**

where **D-modified** means:

> 3 independent analyses → **error/disagreement audit** → **new final answer**

not:

> 3 answers → pick a winner → polish it.

That distinction is significant.

At four calls, **A is the clearest winner** because we have direct fixed-budget experimental evidence closely matching that architecture. citeturn16view7

At three calls, **2 independent + synthesis** is my general-purpose choice.

At five, **3 + audit + reconstruction**.

At six, **3 + two specialized audits + reconstruction**.

## A practical “maximum quality” protocol

There are several implementation details that may matter almost as much as the topology of the calls.

### Keep the exploratory calls blind

Do **not** pass Candidate A to B or A+B to C.

Their role is to produce different information.

Once they see one another, you begin exchanging independence for convergence. The homogeneous-debate results provide direct evidence that such interaction can cause agents to discard initially correct alternatives and adopt modal answers. citeturn21view8turn21view10

Think of your pipeline as having a deliberate **firewall**:

```text
                     ┌── Candidate A ──┐
Original question ───┼── Candidate B ──┼──► Synthesis/Audit
                     └── Candidate C ──┘
```

not:

```text
Question → A → B reads A → C reads A+B → final
```

The first topology spends compute on **search**.

The second primarily spends compute on **one increasingly elaborate trajectory**.

### Do not make every candidate identical in behavior

You can use the same underlying model without using identical cognitive instructions.

The goal should be **controlled diversity**, not randomness for its own sake.

For analytical questions, I would use three variations:

**Primary analyst**

> “Build the strongest complete answer.”

**Independent skeptic**

> “Solve independently, with emphasis on assumptions, contrary evidence, and reasons the obvious conclusion might fail.”

**Alternative analyst**

> “Solve independently using a different decomposition; focus on factors or evidence another analyst is likely to miss.”

Importantly, none should be told:

> “Here is what the other analyst concluded.”

The Generative Self-Aggregation study found that increasing sampling diversity helped until candidate quality began to fall, and also found prompt-template variation to be a viable way of obtaining diverse candidates. citeturn16view7

### Make synthesis generative, not electoral

This is probably the **single prompt change I would care about most**.

Bad:

> “Which of these three answers is best? Return the best.”

Better:

> “Compare these three and combine the best parts.”

Best:

> **“Solve the original question yourself. These three outputs are independent, fallible working notes. Use them to expand your search space. Re-evaluate all major claims, reconcile disagreements, and construct a new answer that may differ from every candidate.”**

Why?

Because choose-from-N can only return something already present.

Generative synthesis can theoretically:

\[
\text{correct part of A} +
\text{correct part of B} -
\text{mistake shared by A/B} +
\text{insight from C}
\]

and produce a solution that none contained individually.

That is exactly the advantage observed in the GSA case analysis. citeturn16view7

### Ask critics to find specific failure types

“Critique this answer” is weak.

The Self-Refine literature itself found that informative, specific feedback matters, while newer self-correction results indicate that locating the actual mistake is the difficult step. citeturn22view0turn21view3

Use a checklist such as:

> factual errors  
> unsupported assumptions  
> contradictory statements  
> mathematical/logical errors  
> missing evidence  
> ignored alternatives  
> uncertainty expressed too confidently  
> conclusions that do not follow from evidence  
> shared assumptions appearing in multiple drafts

This turns “reflection” into a structured search problem.

### Use external signals whenever they exist

This is one of the most consistent findings in the literature.

For code: **tests**.

For math: **calculator/symbolic checking where applicable**.

For factual research: **sources/retrieval**.

For data analysis: **actual computation**.

For constraint satisfaction: **programmatic validation**.

For a document: **the actual source text**.

Once there is an external signal, refinement becomes significantly more trustworthy because the model is no longer being asked to simultaneously invent both the answer and the evidence that its answer is wrong. citeturn21view1turn21view3turn21view12

### Do not automatically spend all available compute

More iterations do not monotonically imply better answers.

Self-Refine observed non-monotonic behavior on some multi-aspect tasks. citeturn23view0

The 2026 agent scaling study found frequent reflection could underperform both baseline and selective reflection. citeturn23view5

General AgentBench found that sequential scaling often eventually reached a context “ceiling,” after which additional interaction stagnated or degraded. citeturn15view1

And Snell et al. found that the ideal allocation of inference compute depends substantially on the difficulty of the individual question. citeturn21view4

So a sophisticated production system should eventually be:

> **adaptive**, not permanently fixed at six calls.

For example:

```text
Generate A and B
       │
       ▼
Do they substantially agree?
   │             │
  yes            no
   │             │
quick synthesis   generate C
                  │
                  ▼
             audit disagreements
                  │
                  ▼
              final synthesis
```

That is closer to the broader direction of current test-time-scaling research than a fixed “always think six times” rule. Adaptive Branching MCTS explicitly formalizes this idea of deciding whether additional compute should go **wider** into new alternatives or **deeper** into promising existing ones. citeturn21view11

## Final recommendation

Putting all of the research together, I would change your mental model from:

> **“How many times should I ask the model the question?”**

to:

> **“How should I divide my inference budget among exploration, error detection, and final synthesis?”**

For most serious analytical work, my answer is:

\[
\boxed{\text{Explore independently first} \rightarrow
\text{diagnose disagreements} \rightarrow
\text{generate the final answer}}
\]

The research does **not** support a general rule that repeatedly asking one trajectory to critique itself is superior. Intrinsic self-correction is inconsistent on objective reasoning and can make correct answers worse. citeturn21view0turn21view1

The research **does** strongly support obtaining multiple independent reasoning trajectories. Classic self-consistency, repeated-sampling work, recent agentic scaling experiments, and production research systems all show value from expanding the solution space. citeturn20view0turn21view6turn23view2turn13view1

The important caveat is that **generation is often easier than verification**. Producing five candidates does not help if your sixth call cannot distinguish a subtle error from a correct answer. citeturn15view1turn22view2

That is why the most interesting direct result for your use case is Generative Self-Aggregation: under an equal four-call budget, **three independent generations followed by a call that constructs a new answer** generally beat self-refinement and simply asking the model to choose among candidates. citeturn16view7

So for your workflow, I would adopt this as the baseline:

> ### **Standard quality mode — four calls**
>
> **Three blind, independent analyses → one fresh generative synthesis**

For more important questions:

> ### **High-quality mode — five calls**
>
> **Three blind analyses → one dedicated error/disagreement audit → one fresh final reconstruction**

And for the questions where you care enough to spend the full budget:

> ### **Maximum-analysis mode — six calls**
>
> **Three blind analyses → one factual/evidence audit + one reasoning/completeness audit → one fresh final reconstruction**

For math, replace much of the synthesis machinery with independent sampling and objective voting/checking. For coding, replace internal critique with execution and test feedback. For writing, shift budget from parallel exploration toward sequential rubric-based refinement. citeturn20view0turn21view12turn22view0

The deeper principle is that **six correlated thoughts are not necessarily better than three genuinely different attempts**. The value of additional inference comes from finding information, reasoning paths, or errors that the first attempt missed—not merely from making the same model look at its own answer for longer. The strongest modern test-time-scaling work increasingly treats this as an **exploration-versus-exploitation allocation problem**, with adaptive hybrid approaches outperforming purely wide or purely deep strategies when good feedback signals are available. citeturn21view4turn21view11turn17view0