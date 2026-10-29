import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';
import { spreadsheetRow } from '@/lib/csv';
import type { ImportProblem } from './admin-api';

/** Problems found in an import file, by row and column, so they can be fixed in the spreadsheet. */
export function ProblemList({
  problems,
  rowNumbers = [],
}: {
  problems: ImportProblem[];
  /** Spreadsheet row of each data row, so that problems point at the right row. */
  rowNumbers?: readonly number[];
}) {
  const { t } = useTranslation();
  return (
    <Alert tone="danger" assertive title={t('admin.import.rejected', { count: problems.length })}>
      <p>{t('admin.import.rejectedHint')}</p>
      <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
        {problems.map((problem) => (
          <li key={`${String(problem.row)}-${problem.field}-${problem.issue}`} className="text-fg">
            {t('admin.import.problem', {
              row: spreadsheetRow(rowNumbers, problem.row),
              column: problem.field,
              issue: t(`admin.import.issues.${problem.issue}`),
            })}
          </li>
        ))}
      </ul>
    </Alert>
  );
}
