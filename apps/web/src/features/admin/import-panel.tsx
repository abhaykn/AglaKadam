import { Download, FileUp, Upload } from 'lucide-react';
import { useId, useState, type ChangeEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CsvFormatError, downloadTextFile, parseCsv, toCsv, toRecords } from '@/lib/csv';
import { ImportRejectedError, type ImportProblem } from './admin-api';
import { ProblemList } from './problem-list';

/** Every column an import understands; each has a description in the translation catalogue. */
export type ImportColumnName =
  | 'state_code'
  | 'state_name'
  | 'state_name_hi'
  | 'district_code'
  | 'district_name'
  | 'district_name_hi'
  | 'block_code'
  | 'block_name'
  | 'block_name_hi'
  | 'cluster_code'
  | 'cluster_name'
  | 'cluster_name_hi'
  | 'udise_code'
  | 'school_name'
  | 'school_name_hi'
  | 'village'
  | 'full_name'
  | 'mobile'
  | 'role'
  | 'scope_code'
  | 'preferred_language'
  | 'starts_on'
  | 'gender'
  | 'grade'
  | 'section'
  | 'admission_number'
  | 'date_of_birth'
  | 'has_special_needs';

export interface ImportColumn {
  name: ImportColumnName;
  required: boolean;
}

interface ImportPanelProps<Result> {
  columns: ImportColumn[];
  /** File name of the downloadable header-only template. */
  templateFileName: string;
  maxRows: number;
  disabled?: boolean;
  onImport: (records: Record<string, string>[]) => Promise<Result>;
  /** Renders the outcome; `rowNumbers` gives the spreadsheet row of each data row. */
  renderResult: (result: Result, rowNumbers: readonly number[]) => ReactNode;
}

type PanelState<Result> =
  | { step: 'idle' }
  | {
      step: 'ready';
      fileName: string;
      records: Record<string, string>[];
      rowNumbers: number[];
      unknownColumns: string[];
    }
  | { step: 'importing'; fileName: string; records: Record<string, string>[]; rowNumbers: number[] }
  | { step: 'done'; result: Result; rowNumbers: number[] }
  | { step: 'rejected'; problems: ImportProblem[]; rowNumbers: number[] }
  | { step: 'failed'; message: string };

/**
 * Choose a CSV file, check its columns, import it and show either a summary or every problem with
 * its row. Nothing is written unless the whole file is valid.
 */
export function ImportPanel<Result>({
  columns,
  templateFileName,
  maxRows,
  disabled = false,
  onImport,
  renderResult,
}: ImportPanelProps<Result>) {
  const { t } = useTranslation();
  const inputId = useId();
  const [state, setState] = useState<PanelState<Result>>({ step: 'idle' });

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    try {
      const table = parseCsv(await file.text());
      const { records, missingColumns, unknownColumns, duplicateColumns } = toRecords(
        table,
        columns,
      );
      if (duplicateColumns.length > 0) {
        setState({
          step: 'failed',
          message: t('admin.import.duplicateColumns', { columns: duplicateColumns.join(', ') }),
        });
        return;
      }
      if (missingColumns.length > 0) {
        setState({
          step: 'failed',
          message: t('admin.import.missingColumns', { columns: missingColumns.join(', ') }),
        });
        return;
      }
      if (records.length === 0) {
        setState({ step: 'failed', message: t('admin.import.noRows') });
        return;
      }
      if (records.length > maxRows) {
        setState({ step: 'failed', message: t('admin.import.tooManyRows', { max: maxRows }) });
        return;
      }
      setState({
        step: 'ready',
        fileName: file.name,
        records,
        rowNumbers: table.rowNumbers,
        unknownColumns,
      });
    } catch (error) {
      setState({
        step: 'failed',
        message:
          error instanceof CsvFormatError
            ? t(`admin.import.formatErrors.${error.reason}`)
            : t('admin.import.unreadable'),
      });
    }
  };

  const runImport = async () => {
    if (state.step !== 'ready') {
      return;
    }
    const { fileName, records, rowNumbers } = state;
    setState({ step: 'importing', fileName, records, rowNumbers });
    try {
      setState({ step: 'done', result: await onImport(records), rowNumbers });
    } catch (error) {
      if (error instanceof ImportRejectedError) {
        setState({ step: 'rejected', problems: error.problems, rowNumbers });
      } else {
        setState({ step: 'failed', message: t('admin.import.failed') });
      }
    }
  };

  const downloadTemplate = () => {
    downloadTextFile(templateFileName, toCsv([columns.map((column) => column.name)]));
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium text-fg">{t('admin.import.columnsTitle')}</p>
        <ul className="mt-2 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {columns.map((column) => (
            <li key={column.name}>
              <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-fg">
                {column.name}
              </code>{' '}
              <span className="text-fg-muted">
                {t(`admin.columns.${column.name}`)}
                {column.required ? '' : ` (${t('admin.import.optional')})`}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-fg-muted">{t('admin.import.utf8Hint')}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          onClick={downloadTemplate}
          leadingIcon={<Download aria-hidden="true" />}
        >
          {t('admin.import.downloadTemplate')}
        </Button>
        <label
          htmlFor={inputId}
          className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-[0.625rem] border border-border bg-surface px-4 text-[0.9375rem] font-medium text-fg shadow-xs transition-colors hover:border-border-strong hover:bg-surface-muted has-[:disabled]:pointer-events-none has-[:disabled]:opacity-55 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
        >
          <FileUp className="size-[1.15em]" aria-hidden="true" />
          {t('admin.import.chooseFile')}
          <input
            id={inputId}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            disabled={disabled || state.step === 'importing'}
            onChange={(event) => void readFile(event)}
          />
        </label>
      </div>

      {state.step === 'ready' || state.step === 'importing' ? (
        <div className="space-y-3 rounded-xl border border-border bg-surface-muted p-4">
          <p className="text-sm text-fg">
            {t('admin.import.fileReady', { file: state.fileName, count: state.records.length })}
          </p>
          {state.step === 'ready' && state.unknownColumns.length > 0 ? (
            <p className="text-sm text-fg-muted">
              {t('admin.import.ignoredColumns', { columns: state.unknownColumns.join(', ') })}
            </p>
          ) : null}
          <Button
            onClick={() => void runImport()}
            isLoading={state.step === 'importing'}
            disabled={disabled}
            leadingIcon={<Upload aria-hidden="true" />}
          >
            {t('admin.import.start', { count: state.records.length })}
          </Button>
        </div>
      ) : null}

      {state.step === 'done' ? renderResult(state.result, state.rowNumbers) : null}
      {state.step === 'rejected' ? (
        <ProblemList problems={state.problems} rowNumbers={state.rowNumbers} />
      ) : null}
      {state.step === 'failed' ? (
        <Alert tone="danger" assertive>
          {state.message}
        </Alert>
      ) : null}
    </div>
  );
}
