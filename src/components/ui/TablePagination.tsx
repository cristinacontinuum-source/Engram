import React from 'react';
import { getVisiblePageNumbers } from '../../utils/pagination';
import { CustomSelect } from './CustomSelect';

const DEFAULT_PAGE_SIZE_OPTIONS = [
  { value: '5', label: '5' },
  { value: '10', label: '10' },
  { value: '20', label: '20' },
  { value: '50', label: '50' },
];

interface TablePaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: string) => void;
  pageSizeOptions?: Array<{ value: string; label: string }>;
  testIdPrefix?: string;
}

export const TablePagination: React.FC<TablePaginationProps> = ({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  testIdPrefix = 'table',
}) => {
  const visiblePages = getVisiblePageNumbers(currentPage, totalPages);

  return (
    <div
      className="px-4 py-3 hairline-border-t flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
      style={{ backgroundColor: 'var(--bg-elevated)' }}
      data-testid={`${testIdPrefix}-pagination`}
    >
      <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
        <span>Showing</span>
        <div className="w-16">
          <CustomSelect
            ariaLabel={`${testIdPrefix} items per page`}
            value={pageSize}
            options={pageSizeOptions}
            onChange={(val) => onPageSizeChange(val)}
            size="xs"
            mono
            dropUp
          />
        </div>
        <span>items per page ({totalItems} total)</span>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          data-testid={`${testIdPrefix}-page-prev`}
          className="px-2.5 py-1 rounded-[4px] reui-btn-secondary text-xs disabled:opacity-40 cursor-pointer"
        >
          Previous
        </button>

        {visiblePages.map((item, idx) =>
          item === 'ellipsis' ? (
            <span
              key={`ellipsis-${idx}`}
              className="px-1.5 font-mono-data text-xs select-none"
              style={{ color: 'var(--text-muted)' }}
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              data-testid={`${testIdPrefix}-page-${item}`}
              className={`w-7 h-7 rounded-[4px] text-xs font-mono-data font-medium transition-colors cursor-pointer ${
                item === currentPage ? 'reui-btn-primary' : 'reui-btn-secondary'
              }`}
            >
              {item}
            </button>
          )
        )}

        <button
          type="button"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          data-testid={`${testIdPrefix}-page-next`}
          className="px-2.5 py-1 rounded-[4px] reui-btn-secondary text-xs disabled:opacity-40 cursor-pointer"
        >
          Next
        </button>
      </div>
    </div>
  );
};
