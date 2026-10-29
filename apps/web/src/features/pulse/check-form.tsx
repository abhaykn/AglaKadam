import { useTranslation } from 'react-i18next';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { cn } from '@/lib/cn';
import {
  ADAPTED_TAGS,
  RECORDED_TAGS,
  type CheckFormValues,
  type CheckTag,
} from './check-form-values';

/** The teacher's short form after a check: taps only, no typing. */

interface CheckFormProps {
  /** `adapted`: the teacher-observed check of a child with special needs (no voice or room). */
  kind: 'recorded' | 'adapted';
  readingLanguage: 'hi' | 'en';
  values: CheckFormValues;
  onChange: (values: CheckFormValues) => void;
  /** Point out the questions still unanswered (after an attempt to save). */
  showMissing: boolean;
}

export function CheckForm({
  kind,
  readingLanguage,
  values,
  onChange,
  showMissing,
}: CheckFormProps) {
  const { t } = useTranslation();
  const set = <Key extends keyof CheckFormValues>(key: Key, value: CheckFormValues[Key]) =>
    onChange({ ...values, [key]: value });
  const missing = (answered: boolean) =>
    showMissing && !answered ? t('pulse.form.required') : null;
  const language = readingLanguage === 'hi' ? t('pulse.language.hi') : t('pulse.language.en');
  const tags: readonly CheckTag[] = kind === 'adapted' ? ADAPTED_TAGS : RECORDED_TAGS;

  return (
    <div className="space-y-5">
      <ChoiceGroup
        label={t('pulse.form.reading', { language })}
        value={values.readingLevel}
        onChange={(value) => set('readingLevel', value)}
        options={(['fluent', 'hesitant', 'needs_support'] as const).map((value) => ({
          value,
          label: t(`pulse.form.readingOption.${kind}.${value}`),
        }))}
        error={missing(values.readingLevel !== null)}
      />
      <ChoiceGroup
        label={t('pulse.form.english')}
        value={values.englishLevel}
        onChange={(value) => set('englishLevel', value)}
        options={(['sentences', 'words', 'no_response'] as const).map((value) => ({
          value,
          label: t(`pulse.form.englishOption.${value}`),
        }))}
        error={missing(values.englishLevel !== null)}
      />
      {kind === 'recorded' ? (
        <>
          <ChoiceGroup
            label={t('pulse.form.clarity')}
            value={values.clarity}
            onChange={(value) => set('clarity', value)}
            options={(['clear', 'low_voice', 'nervous'] as const).map((value) => ({
              value,
              label: t(`pulse.form.clarityOption.${value}`),
            }))}
            error={missing(values.clarity !== null)}
          />
          <ChoiceGroup
            label={t('pulse.form.classroom')}
            value={values.classroom}
            onChange={(value) => set('classroom', value)}
            options={(['normal', 'noisy'] as const).map((value) => ({
              value,
              label: t(`pulse.form.classroomOption.${value}`),
            }))}
            error={missing(values.classroom !== null)}
          />
        </>
      ) : null}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-fg">{t('pulse.form.notes')}</legend>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => {
            const selected = values.tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  set(
                    'tags',
                    selected ? values.tags.filter((entry) => entry !== tag) : [...values.tags, tag],
                  )
                }
                className={cn(
                  'min-h-10 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                  selected
                    ? 'border-primary bg-primary-soft text-primary-soft-fg'
                    : 'border-border bg-surface text-fg hover:bg-surface-muted',
                )}
              >
                {t(`pulse.form.tag.${tag}`)}
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
