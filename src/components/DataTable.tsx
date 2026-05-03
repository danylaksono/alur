import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import { useMemo } from 'react';

interface DataTableProps {
  data: any[];
  isLoading?: boolean;
}

export const DataTable = ({ data, isLoading }: DataTableProps) => {
  const columnHelper = createColumnHelper<any>();

  const columns = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    // Get keys from the first row, excluding internal/heavy columns
    const keys = Object.keys(data[0]).filter(key => 
      key !== 'geojson' && key !== 'geometry' && key !== 'geom'
    );

    return keys.map(key => 
      columnHelper.accessor(key, {
        header: key,
        cell: info => {
          const value = info.getValue();
          if (value === null || value === undefined) return <span className="text-slate-300 italic">null</span>;
          if (typeof value === 'object') return JSON.stringify(value);
          return String(value);
        },
      })
    );
  }, [data]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-white/50 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-2">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Loading Data...</span>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-slate-400 text-[11px] italic bg-slate-50">
        No attribute data available for the selected node.
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto bg-white">
      <table className="w-full border-collapse text-[11px]">
        <thead className="sticky top-0 bg-slate-100 z-10 shadow-sm">
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <th key={header.id} className="text-left px-3 py-2 border-b border-r border-slate-200 font-bold text-slate-600 uppercase tracking-wider whitespace-nowrap">
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-slate-100">
          {table.getRowModel().rows.map(row => (
            <tr key={row.id} className="hover:bg-slate-50 transition-colors">
              {row.getVisibleCells().map(cell => (
                <td key={cell.id} className="px-3 py-1.5 border-r border-slate-100 text-slate-700 whitespace-nowrap max-w-[200px] truncate">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
