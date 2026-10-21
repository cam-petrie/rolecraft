export function createDemo() {
  const lines = [
    "Alex Morgan",
    "Software engineer · New York, NY · alex@example.com",
    "SUMMARY",
    "Software engineer with 5 years of experience building reliable customer-facing web applications.",
    "EXPERIENCE",
    "Software Engineer · Northstar Labs · 2021–present",
    "Worked on the checkout service using TypeScript and React.",
    "Improved API response times by 35% by optimizing PostgreSQL queries.",
    "Helped with deployments and monitoring using AWS and GitHub Actions.",
    "Collaborated with product and design to launch a self-service billing dashboard.",
    "Mentored two junior engineers through weekly code reviews.",
    "SKILLS",
    "TypeScript · React · Node.js · PostgreSQL · AWS · GitHub Actions",
    "EDUCATION",
    "B.S. Computer Science · State University · 2020",
  ];
  const paragraphs = lines.map((text, i) => ({
    id: `p${i}`,
    text,
    editable: true,
  }));
  return {
    id: crypto.randomUUID(),
    kind: "demo",
    filename: "Alex_Morgan_Resume.docx",
    original: new ArrayBuffer(0),
    baseline: structuredClone(paragraphs),
    paragraphs,
    versions: [],
    role: {
      title: "Senior Software Engineer",
      company: "Meridian",
      url: "",
      text: "Meridian is hiring a Senior Software Engineer to build customer-facing financial products. Requirements: strong TypeScript and React experience; backend API development with Node.js and PostgreSQL; cloud deployment on AWS; CI/CD and production observability; collaboration with product and design. The engineer will own system architecture, lead complex projects, mentor teammates and support a production on-call rotation. Experience with distributed systems and financial compliance is preferred.",
    },
    analysis: null,
    prep: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
export const demoAnalysis = {
  score: 74,
  verdict:
    "A credible product engineer, but the resume does not yet show senior-level architectural ownership. Strong delivery evidence; thin evidence of operating distributed systems.",
  matches: [
    {
      title: "TypeScript & React",
      evidence: "Worked on the checkout service using TypeScript and React.",
      requirement: "Strong TypeScript and React experience",
    },
    {
      title: "Measurable database impact",
      evidence:
        "Improved API response times by 35% by optimizing PostgreSQL queries.",
      requirement: "Backend API development with PostgreSQL",
    },
    {
      title: "Cloud delivery",
      evidence:
        "Helped with deployments and monitoring using AWS and GitHub Actions.",
      requirement: "Cloud deployment on AWS; CI/CD",
    },
    {
      title: "Cross-functional delivery",
      evidence:
        "Collaborated with product and design to launch a self-service billing dashboard.",
      requirement: "Collaboration with product and design",
    },
    {
      title: "Mentoring",
      evidence: "Mentored two junior engineers through weekly code reviews.",
      requirement: "Mentor teammates",
    },
  ],
  gaps: [
    {
      title: "Architecture ownership is unclear",
      reason: "No architectural decision, scope or tradeoff is described.",
      action: "Add a specific design decision only if you owned it.",
    },
    {
      title: "No distributed systems evidence",
      reason: "The listing prefers distributed systems experience.",
      action: "Identify a real example or acknowledge this as a learning area.",
    },
    {
      title: "On-call work is not established",
      reason: "Monitoring does not establish incident-response ownership.",
      action: "Clarify actual incident-response responsibilities, if any.",
    },
    {
      title: "Leadership scope is limited",
      reason:
        "Mentoring is present, but leading complex projects is not demonstrated.",
      action: "Describe a real project you led and your scope.",
    },
    {
      title: "Financial compliance is unproven",
      reason: "A billing dashboard does not establish compliance expertise.",
      action: "Do not imply compliance experience; prepare to discuss the gap.",
    },
  ],
  rewrites: [
    {
      paragraphId: "p6",
      before: "Worked on the checkout service using TypeScript and React.",
      after: "Contributed to the checkout service using TypeScript and React.",
      reason:
        "Use a clearer action verb without claiming ownership or inventing impact.",
      fitImpact: { minPoints: 0, maxPoints: 1, rationale: "Makes the contribution easier to read; it does not add evidence of senior ownership." },
    },
    {
      paragraphId: "p8",
      before:
        "Helped with deployments and monitoring using AWS and GitHub Actions.",
      after:
        "Supported deployments and monitoring using AWS and GitHub Actions.",
      reason:
        "Clarify contribution while retaining the source’s limited scope.",
      fitImpact: { minPoints: 0, maxPoints: 1, rationale: "Clarifies AWS and CI/CD exposure, but does not establish deployment ownership." },
    },
    {
      paragraphId: "p9",
      before:
        "Collaborated with product and design to launch a self-service billing dashboard.",
      after:
        "Launched a self-service billing dashboard in collaboration with product and design.",
      reason:
        "Lead with the delivered outcome without adding unsupported metrics.",
      fitImpact: { minPoints: 1, maxPoints: 2, rationale: "Brings product delivery and cross-functional collaboration to the front of the bullet." },
    },
  ],
};
export function demoPrep(w) {
  return {
    overview:
      "Example preparation pack. Focus on one concrete architecture decision, your PostgreSQL optimization, and how you work with product and design. This is fixed sample content, not AI analysis.",
    mappings: [
      {
        paragraphId: "p7",
        evidence: w.paragraphs.find((p) => p.id === "p7").text,
        requirement: "Backend API development with PostgreSQL",
        talkingPoints: [
          "Explain the original query bottleneck and how you measured latency.",
          "Describe the query plan and indexing tradeoff.",
          "Explain how you verified the 35% improvement.",
        ],
      },
    ],
    studyGuides: [
      {
        topic: "PostgreSQL query performance",
        why: "Your strongest quantified result directly matches the backend requirement.",
        lessons: [
          "EXPLAIN ANALYZE runs a query and reports actual execution times and row counts. Compare estimates to actuals to spot selectivity errors; use caution on write queries.",
          "A composite B-tree index supports lookups on leading columns. More indexes improve reads but consume storage and increase write cost. For a query filtered by account and sorted by creation time, test an index on (account_id, created_at).",
          "Measure p50 and p95 latency on representative production-like data. Separate database execution time from network and application overhead.",
        ],
        exercise:
          "Create a table with 100,000 rows. Compare a filtered query before and after adding an index. Explain the query-plan change and write-cost tradeoff.",
      },
    ],
    questions: [
      {
        stage: "screening",
        question: "Why does this senior role fit your next step?",
        why: "The resume demonstrates delivery, but senior scope is unclear.",
        answerGuide:
          "Connect your real product delivery and mentoring to the role. Name one growth area and avoid claiming unproven architecture ownership.",
        paragraphIds: ["p9", "p10"],
      },
      {
        stage: "screening",
        question: "Tell me about mentoring two junior engineers.",
        why: "The role requires mentoring.",
        answerGuide:
          "Use a real example: feedback you gave, how the engineer responded, and what changed. Add outcomes only if you can substantiate them.",
        paragraphIds: ["p10"],
      },
      {
        stage: "technical",
        question: "How did you achieve the 35% API response-time improvement?",
        why: "This is the clearest measurable technical claim.",
        answerGuide:
          "Describe the baseline, diagnostic method, query changes, measurement window and regression checks. Be ready to distinguish mean from p95.",
        paragraphIds: ["p7"],
      },
      {
        stage: "technical",
        question:
          "How would you make a checkout API resilient to duplicate requests?",
        why: "Checkout work relates to the role’s distributed-systems preference.",
        answerGuide:
          "Study idempotency keys, atomic writes, retries and duplicate detection. Present a design proposal, and distinguish it from systems you have actually built.",
        paragraphIds: ["p6"],
      },
    ],
  };
}
