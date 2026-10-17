import { z } from "zod";
export function phone(value: string) {
  const v = value
    .replace(/[\s()-]/g, "")
    .replace(/^\+972/, "0")
    .replace(/^972/, "0");
  if (!/^05\d{8}$/.test(v)) throw new Error("מספר הטלפון אינו תקין");
  return v;
}
export const signup = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z
    .string()
    .max(30)
    .transform((value, ctx) => {
      try {
        return phone(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "מספר הטלפון אינו תקין" });
        return z.NEVER;
      }
    }),
  password: z.string().min(12).max(128),
  teamId: z.uuid(),
  partnered: z.boolean().default(false),
});
export const uuid = z.uuid();
export const password = z.string().min(12).max(128);
