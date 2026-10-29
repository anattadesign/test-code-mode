import { useEffect, useRef, useState } from "react";

/**
 * Track the value of a Polaris web component (s-select, s-choice-list, s-checkbox…).
 * React 18 doesn't route `onChange` for custom elements, so listen to the native
 * `input` and `change` events instead. Form submission still reads the element's
 * own `name`/`value`; this hook only drives conditional UI.
 * Pass a stable `read` function (the module-level readers below).
 */
export function useElementValue<T>(initial: T, read: (el: HTMLElement) => T) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Polaris element types differ per tag
  const ref = useRef<any>(null);
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => setValue(read(el));
    el.addEventListener("input", handler);
    el.addEventListener("change", handler);
    return () => {
      el.removeEventListener("input", handler);
      el.removeEventListener("change", handler);
    };
  }, [read]);

  return [ref, value, setValue] as const;
}

/**
 * Collect every named field in a container into FormData, reading Polaris web
 * components' `value` / `checked` properties directly. Works whether or not the
 * components take part in native form submission.
 */
export function collectFormData(root: HTMLElement): FormData {
  const data = new FormData();
  root.querySelectorAll<HTMLElement>("[name]").forEach((el) => {
    const name = el.getAttribute("name");
    if (!name) return;
    const tag = el.tagName.toLowerCase();
    const field = el as HTMLInputElement;
    if (tag === "s-checkbox" || tag === "s-switch" || field.type === "checkbox") {
      if (field.checked) data.set(name, field.value || "on");
      return;
    }
    data.set(name, field.value ?? "");
  });
  return data;
}

export const readValue = (el: HTMLElement) => (el as HTMLInputElement).value;
export const readValues = (el: HTMLElement) =>
  ((el as unknown as { values?: string[] }).values ?? []) as string[];
export const readChecked = (el: HTMLElement) => Boolean((el as HTMLInputElement).checked);
