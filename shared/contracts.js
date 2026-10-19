import { z } from "zod";
const text = z.string().min(1).max(10000);
export const paragraphSchema = z.object({
  id: z.string().max(100),
  text: z.string().max(12000),
  editable: z.boolean(),
  role: z.enum(["name", "contact", "heading", "entry", "body"]).optional(),
});
export const roleSchema = z.object({
  title: z.string().max(300),
  company: z.string().max(300),
  url: z.string().max(3000),
  text: z.string().max(60000),
});
export const analysisSchema = z.object({
  score: z.number().int().min(0).max(100),
  verdict: text,
  matches: z
    .array(z.object({ title: text, evidence: text, requirement: text }))
    .length(5),
  gaps: z
    .array(z.object({ title: text, reason: text, action: text }))
    .length(5),
  rewrites: z
    .array(
      z.object({
        paragraphId: z.string(),
        before: text,
        after: text,
        reason: text,
      }),
    )
    .length(3),
});
export const rewriteSchema = z.object({
  paragraphId: z.string(),
  before: text,
  after: text,
  reason: text,
});
export const prepSchema = z.object({
  overview: text,
  mappings: z
    .array(
      z.object({
        paragraphId: z.string(),
        evidence: text,
        requirement: text,
        talkingPoints: z.array(text).min(1).max(5),
      }),
    )
    .min(1)
    .max(20),
  studyGuides: z
    .array(
      z.object({
        topic: text,
        why: text,
        lessons: z.array(text).min(2).max(6),
        exercise: text,
      }),
    )
    .min(1)
    .max(8),
  questions: z
    .array(
      z.object({
        stage: z.enum(["screening", "technical"]),
        question: text,
        why: text,
        answerGuide: text,
        paragraphIds: z.array(z.string()).max(10),
      }),
    )
    .min(4)
    .max(20)
    .refine(
      (q) =>
        q.some((x) => x.stage === "screening") &&
        q.some((x) => x.stage === "technical"),
      "Include both screening and technical questions.",
    ),
});
export const requestSchema = z.object({
  task: z.enum(["analyze", "rewrite", "prep"]),
  paragraphs: z.array(paragraphSchema).min(1).max(800),
  role: roleSchema,
  paragraphId: z.string().max(100).optional(),
  instruction: z.string().max(2000).optional(),
});
export function assertEvidence(task, data, paragraphs, role) {
  const byId = new Map(paragraphs.map((p) => [p.id, p]));
  const rewrites =
    task === "analyze" ? data.rewrites : task === "rewrite" ? [data] : [];
  if (new Set(rewrites.map((r) => r.paragraphId)).size !== rewrites.length)
    throw new Error("AI returned duplicate rewrite targets. Please try again.");
  for (const r of rewrites) {
    const p = byId.get(r.paragraphId);
    if (!p?.editable || p.text !== r.before)
      throw new Error(
        "AI rewrite did not match an editable source paragraph. Please try again.",
      );
  }
  if (task === "analyze")
    for (const m of data.matches)
      if (!paragraphs.some((p) => p.text.includes(m.evidence)))
        throw new Error(
          "AI match evidence was not found in the resume. Please retry.",
        );
  const normalize = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
  if (role)
    for (const m of task === "prep"
      ? data.mappings
      : task === "analyze"
        ? data.matches
        : [])
      if (!normalize(role.text).includes(normalize(m.requirement)))
        throw new Error(
          "AI requirement did not match the job description. Please retry.",
        );
  if (task === "prep") {
    for (const m of data.mappings)
      if (byId.get(m.paragraphId)?.text !== m.evidence)
        throw new Error(
          "Interview evidence did not match the resume. Please regenerate.",
        );
    for (const q of data.questions)
      if (q.paragraphIds.some((id) => !byId.has(id)))
        throw new Error("Interview question referenced missing evidence.");
  }
  return data;
}
export function signature(paragraphs, role) {
  return JSON.stringify({
    paragraphs: paragraphs.map((p) => [p.id, p.text]),
    role,
  });
}
export function applyRewrite(paragraphs, rewrite) {
  const p = paragraphs.find((p) => p.id === rewrite.paragraphId);
  if (!p?.editable || p.text !== rewrite.before)
    throw new Error(
      "This paragraph has changed. Request a new suggestion before applying.",
    );
  return paragraphs.map((p) =>
    p.id === rewrite.paragraphId ? { ...p, text: rewrite.after } : p,
  );
}
