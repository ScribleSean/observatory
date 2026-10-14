export function format(template, values) {
  return template.replace(/\{([a-z][A-Za-z0-9]*)\}/g, (_, name) => {
    if (!Object.hasOwn(values, name)) throw new Error(`Missing placeholder: ${name}`);
    return String(values[name]);
  });
}
