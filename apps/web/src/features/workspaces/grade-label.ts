import type { TFunction } from 'i18next';

/** "Balvatika" for grade 0, otherwise "Class 3" / "कक्षा 3", with the section when there are several. */
export function classLabel(t: TFunction, grade: number, section?: string | null): string {
  const gradeText = grade === 0 ? t('classes.balvatika') : t('classes.grade', { grade });
  return section ? t('classes.withSection', { grade: gradeText, section }) : gradeText;
}
