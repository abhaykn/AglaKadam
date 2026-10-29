import { useTranslation } from 'react-i18next';
import { languageStore, setLanguage, type Language } from '@/features/preferences/preferences';
import { cn } from '@/lib/cn';
import { useStore } from '@/lib/store';

const options: readonly { value: Language; label: string; full: string }[] = [
  { value: 'en', label: 'EN', full: 'English' },
  { value: 'hi', label: 'हिं', full: 'हिन्दी' },
];

interface LanguageSwitchProps {
  className?: string;
  /** "glass" is for the night pages: a frosted pill with a white thumb that slides across. */
  variant?: 'default' | 'glass';
}

/** Two-option language toggle; each option is announced with its full language name. */
export function LanguageSwitch({ className, variant = 'default' }: LanguageSwitchProps) {
  const { t } = useTranslation();
  const language = useStore(languageStore);
  const isGlass = variant === 'glass';
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === language),
  );

  return (
    <div
      role="group"
      aria-label={t('common.language')}
      className={cn(
        'relative inline-flex items-center',
        isGlass
          ? 'liquid-glass h-10 rounded-full p-1'
          : 'h-9 rounded-full border border-border bg-surface p-0.5 shadow-xs',
        className,
      )}
    >
      {isGlass ? (
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-white shadow-md shadow-black/20 transition-transform duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)]"
          style={{ transform: `translateX(${activeIndex * 100}%)` }}
        />
      ) : null}
      {options.map((option) => {
        const isActive = option.value === language;
        return (
          <button
            key={option.value}
            type="button"
            lang={option.value}
            aria-pressed={isActive}
            aria-label={option.full}
            onClick={() => setLanguage(option.value)}
            className={cn(
              'relative z-10 h-full min-w-11 rounded-full px-3 text-sm font-medium transition-colors duration-300 after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[""]',
              isGlass
                ? isActive
                  ? 'text-[hsl(201_100%_13%)]'
                  : 'text-white/75 hover:text-white'
                : isActive
                  ? 'bg-primary text-primary-fg'
                  : 'text-fg-muted hover:text-fg',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
