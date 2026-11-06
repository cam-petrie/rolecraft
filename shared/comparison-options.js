import { z } from "zod";
import { paragraphStructures } from "./resume-structure.js";
export const comparisonOptionsSchema = z.object({
  maxRoles: z.number().int().min(1).max(50).default(10),
  title: z.string().max(200).default(""),
  location: z.string().max(200).default(""),
  exclude: z.string().max(200).default(""),
  level: z.enum(["any", "early", "senior", "lead", "management"]).default("any"),
  remoteOnly: z.boolean().default(false),
});
export const defaultComparisonOptions = comparisonOptionsSchema.parse({});
const stop = new Set("the and with from that this have your our their for was were are has will you they work team experience skills ability required preferred responsibilities qualifications company role senior engineer engineering years using including into through about more working strong development build built job software candidate able".split(" "));
function terms(value, filterStop = true) { return [...new Set((String(value).toLowerCase().match(/[a-z][a-z0-9+#]{2,}/g) || []).filter((word) => !filterStop || !stop.has(word)))]; }
export function resumeSearchTerms(paragraphs) {
  const formats = paragraphStructures(paragraphs);
  const skills = paragraphs.filter((p) => formats.get(p.id)?.kind === "skills-list");
  return terms([...skills, ...paragraphs].map((p) => p.text).join(" ")).slice(0, 120);
}
export function roleLevel(title) {
  if (/\b(manager|director|head|vp|vice president)\b/i.test(title)) return "management";
  if (/\b(staff|principal|lead)\b/i.test(title)) return "lead";
  if (/\b(senior|sr)\b/i.test(title)) return "senior";
  if (/\b(junior|jr|intern|internship|graduate|entry[- ]level)\b/i.test(title)) return "early";
  return "unspecified";
}
export function shortlistCompanyRoles(roles, currentRole, preferences = {}, keywords = []) {
  const options = comparisonOptionsSchema.parse(preferences);
  const titleWords = options.title.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const excluded = options.exclude.toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  const matches = roles.filter((role) => {
    const title = role.title.toLowerCase();
    return titleWords.every((word) => title.includes(word)) && !excluded.some((word) => title.includes(word)) &&
      (!options.location.trim() || (role.location || "").toLowerCase().includes(options.location.toLowerCase().trim())) &&
      (options.level === "any" || roleLevel(role.title) === options.level) &&
      (!options.remoteOnly || (typeof role.remote === "boolean" ? role.remote :
        /\bremote\b/i.test(role.location || "") && !/\b(?:not|no|non)[ -]+remote\b|\bhybrid\b|\bon[- ]?site\b/i.test(role.location || "")));
  });
  const target = new Set(terms(currentRole.title, false));
  const resume = new Set(keywords);
  const relevance = (role) => terms(role.title, false).filter((t) => target.has(t)).length * 6 +
    Math.min(10, terms(role.title + " " + role.text).filter((t) => resume.has(t)).length / 3);
  // Tokenize each description once, rather than again for every sort comparison.
  const ranked = matches.map((role) => ({ role, relevance: relevance(role) }));
  ranked.sort((a, b) => b.relevance - a.relevance || a.role.title.localeCompare(b.role.title) || a.role.url.localeCompare(b.role.url));
  return { roles: ranked.slice(0, options.maxRoles).map((entry) => entry.role), matching: matches.length, preferences: options };
}
