import type { NotifyRecipient } from '../_shared/services.ts';

export interface PushMessage {
  title: string;
  body: string;
  /** The page the notification opens. */
  url: string;
  /** Messages with the same tag replace one another on the phone. */
  tag: string;
}

function plural(count: number, one: string, other: string): string {
  return (count === 1 ? one : other).replace('{n}', String(count));
}

/** The notification in the person's language. It says what is due; it never names a child. */
export function messageFor(recipient: NotifyRecipient): PushMessage {
  const hindi = recipient.language === 'hi';
  const first = recipient.firstCount;
  const second = recipient.secondCount;
  switch (recipient.message) {
    case 'plan_ready': {
      const nothingWaiting = first === 0 && second === 0;
      return {
        title: hindi ? 'आने वाले सप्ताह की योजना बनाइए' : 'Plan the coming week',
        body: nothingWaiting
          ? hindi
            ? 'मुलाक़ात के लिए कक्षाएँ चुनने को सप्ताह की योजना खोलिए।'
            : "Open the week's plan to choose the classes to visit."
          : hindi
            ? `इस सप्ताह ${plural(first, '{n} तय कदम की जाँच', '{n} तय कदमों की जाँच')} और ${plural(second, '{n} मुलाक़ात का अनुरोध', '{n} मुलाक़ात के अनुरोध')} बाकी।`
            : `${plural(first, '{n} check-back', '{n} check-backs')} due and ${plural(second, '{n} visit request', '{n} visit requests')} waiting.`,
        url: '/app/crp/plan',
        tag: 'plan-ready',
      };
    }
    case 'check_back_crp':
      return {
        title: hindi ? 'आज तय कदम की जाँच है' : 'A check-back is due today',
        body: hindi
          ? `आपके क्लस्टर में आज ${plural(first, '{n} तय कदम की जाँच', '{n} तय कदमों की जाँच')} होनी है।`
          : `${plural(first, '{n} agreed step', '{n} agreed steps')} in your cluster ${first === 1 ? 'is' : 'are'} due for a check-back today.`,
        url: '/app/crp',
        tag: 'check-back',
      };
    case 'check_back_teacher':
      return {
        title: hindi ? 'आज आपके तय कदम की जाँच है' : 'Your check-back is today',
        body: hindi
          ? 'आपके सीआरपी आज वह कदम देखेंगे जो आपने साथ तय किया था।'
          : 'Your CRP looks at the step you agreed on together today.',
        url: '/app/teacher',
        tag: 'check-back',
      };
    case 'pulse_week':
      return {
        title: hindi ? 'इस सप्ताह की पल्स खुल गई' : "This week's Pulse is open",
        body: hindi
          ? `आपकी कक्षाओं के ${plural(first, '{n} बच्चे', '{n} बच्चों')} की पल्स जाँच इस सप्ताह होनी है।`
          : `${plural(first, '{n} child', '{n} children')} in your classes ${first === 1 ? 'is' : 'are'} due for a Pulse check this week.`,
        url: '/app/teacher',
        tag: 'pulse-week',
      };
  }
}
