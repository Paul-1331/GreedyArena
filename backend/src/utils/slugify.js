export const slugify = (title) => {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const suffix = Math.random().toString(36).slice(2, 10);
  return `${base}-${suffix}`;
};