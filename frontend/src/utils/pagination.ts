export interface PaginationResult<T> {
  items: T[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
  startItem: number;
  endItem: number;
}

export function paginateItems<T>(
  list: T[],
  requestedPage: number,
  requestedPageSize: number
): PaginationResult<T> {
  const pageSize = Math.max(1, Math.trunc(requestedPageSize) || 10);
  const totalItems = list.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(totalPages, Math.max(1, Math.trunc(requestedPage) || 1));
  const startIdx = (currentPage - 1) * pageSize;
  const items = list.slice(startIdx, startIdx + pageSize);

  return {
    items,
    totalItems,
    totalPages,
    currentPage,
    pageSize,
    startItem: totalItems === 0 ? 0 : startIdx + 1,
    endItem: totalItems === 0 ? 0 : startIdx + items.length,
  };
}

export function getVisiblePageNumbers(
  currentPage: number,
  totalPages: number,
  maxButtons: number = 7
): Array<number | 'ellipsis'> {
  if (totalPages <= maxButtons) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages: Array<number | 'ellipsis'> = [1];
  const left = Math.max(2, currentPage - 1);
  const right = Math.min(totalPages - 1, currentPage + 1);

  if (left > 2) pages.push('ellipsis');
  for (let p = left; p <= right; p++) {
    pages.push(p);
  }
  if (right < totalPages - 1) pages.push('ellipsis');
  pages.push(totalPages);

  return pages;
}
