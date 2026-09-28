export function toolRequest(search: string): {
  page: 'designer' | 'gallery' | 'preview';
  layout: string | null;
} | null {
  const params = new URLSearchParams(search),
    page = params.get('role');
  return page === 'designer' || page === 'gallery' || page === 'preview'
    ? { page, layout: params.get('layout') }
    : null;
}
