/**
 * What a CRP looks at during a visit: the focus items (a short list chosen for each visit instead of
 * a long checklist) and the moment tags tapped while the lesson goes on.
 *
 * The items follow the classroom practices of the NIPUN Bharat foundational literacy guidelines:
 * every child reads, sounds before letters, reading for meaning, oral language in English, the
 * child's home language as a bridge, and attention to the children who struggle. Each item names
 * the practices that strengthen it, so that a "no" leads straight to a step the teacher can take.
 *
 * Codes are stored with each visit and never change; texts may be improved.
 */

export interface LocalText {
  en: string;
  hi: string;
}

export type UiLanguage = 'en' | 'hi';

/** The text in the interface language. */
export function textIn(text: LocalText, language: string): string {
  return language === 'hi' ? text.hi : text.en;
}

export type FocusArea = 'reading' | 'english' | 'inclusion' | 'classroom';

export interface FocusItem {
  code: string;
  area: FocusArea;
  text: LocalText;
  /** What to watch for to answer the item fairly. */
  lookFor: LocalText;
  /** Practices of the library that strengthen this item, most direct first. */
  practices: readonly string[];
}

export const FOCUS_ITEMS: readonly FocusItem[] = [
  {
    code: 'every-child-reads',
    area: 'reading',
    text: {
      en: 'Every child read aloud at least once',
      hi: 'हर बच्चे ने कम से कम एक बार ज़ोर से पढ़ा',
    },
    lookFor: {
      en: 'Count the children who read on their own, not only in chorus.',
      hi: 'गिनिए कि कितने बच्चों ने अकेले पढ़ा, केवल सबके साथ मिलकर नहीं।',
    },
    practices: ['paired-reading', 'small-group-rotation', 'echo-reading'],
  },
  {
    code: 'sounds-before-letters',
    area: 'reading',
    text: {
      en: 'Sounds were practised before letters and words',
      hi: 'अक्षरों और शब्दों से पहले ध्वनियों का अभ्यास हुआ',
    },
    lookFor: {
      en: 'Children say a sound, join sounds into a word, or break a word into its sounds.',
      hi: 'बच्चे ध्वनि बोलते हैं, ध्वनियाँ जोड़कर शब्द बनाते हैं या शब्द को ध्वनियों में तोड़ते हैं।',
    },
    practices: ['sound-blending', 'letter-sound-games'],
  },
  {
    code: 'reads-for-meaning',
    area: 'reading',
    text: {
      en: 'Children talked about what the text means',
      hi: 'बच्चों ने पढ़े गए पाठ के अर्थ पर बात की',
    },
    lookFor: {
      en: 'At least one question about meaning, not only "read it again".',
      hi: 'कम से कम एक प्रश्न अर्थ के बारे में, केवल "फिर से पढ़ो" नहीं।',
    },
    practices: ['open-questions', 'read-aloud-think-aloud'],
  },
  {
    code: 'teacher-models-reading',
    area: 'reading',
    text: {
      en: 'The teacher read aloud fluently before the children read',
      hi: 'बच्चों के पढ़ने से पहले शिक्षक ने धाराप्रवाह और भाव के साथ पढ़कर सुनाया',
    },
    lookFor: {
      en: 'A clear model: right speed, pauses at full stops, expression in the voice.',
      hi: 'साफ़ नमूना: सही गति, पूर्ण विराम पर रुकना, आवाज़ में भाव।',
    },
    practices: ['echo-reading', 'read-aloud-think-aloud'],
  },
  {
    code: 'todays-textbook-page',
    area: 'reading',
    text: {
      en: "The lesson used today's textbook page",
      hi: 'पाठ में पाठ्यपुस्तक के आज वाले पृष्ठ का उपयोग हुआ',
    },
    lookFor: {
      en: 'Books open at the page the class has reached, used by the children themselves.',
      hi: 'किताबें उसी पृष्ठ पर खुली हों जहाँ तक कक्षा पहुँची है, और बच्चे स्वयं उनका उपयोग करें।',
    },
    practices: ['echo-reading', 'paired-reading'],
  },
  {
    code: 'children-write',
    area: 'reading',
    text: {
      en: 'Children wrote something of their own',
      hi: 'बच्चों ने अपनी ओर से कुछ लिखा',
    },
    lookFor: {
      en: 'A word, a line or a labelled drawing of their own, not only copying from the board.',
      hi: 'अपना एक शब्द, एक पंक्ति या नाम लिखा चित्र, केवल बोर्ड से नकल नहीं।',
    },
    practices: ['shared-writing'],
  },
  {
    code: 'english-own-sentences',
    area: 'english',
    text: {
      en: 'Children said English sentences of their own',
      hi: 'बच्चों ने अंग्रेज़ी में अपने वाक्य बोले',
    },
    lookFor: {
      en: 'Sentences the children made, not only repeating after the teacher.',
      hi: 'बच्चों के अपने बनाए वाक्य, केवल शिक्षक के पीछे दोहराना नहीं।',
    },
    practices: ['sentence-frames', 'picture-talk'],
  },
  {
    code: 'english-picture-talk',
    area: 'english',
    text: {
      en: 'Pictures or objects were used to talk in English',
      hi: 'अंग्रेज़ी में बात करने के लिए चित्रों या वस्तुओं का उपयोग हुआ',
    },
    lookFor: {
      en: 'Children name and describe what they see, with the teacher asking "what", "where", "who".',
      hi: 'बच्चे जो देखते हैं उसका नाम लेते हैं और बताते हैं; शिक्षक "क्या", "कहाँ", "कौन" पूछते हैं।',
    },
    practices: ['picture-talk', 'sentence-frames'],
  },
  {
    code: 'home-language-bridge',
    area: 'english',
    text: {
      en: "The children's home language was used to explain",
      hi: 'समझाने के लिए बच्चों की घर की भाषा का उपयोग हुआ',
    },
    lookFor: {
      en: 'A new word or idea linked to a word the children already use at home.',
      hi: 'नए शब्द या बात को उस शब्द से जोड़ना जो बच्चे घर पर पहले से बोलते हैं।',
    },
    practices: ['home-language-bridge'],
  },
  {
    code: 'bottom-group-turns',
    area: 'inclusion',
    text: {
      en: 'Children who struggle got turns and help',
      hi: 'जिन बच्चों को कठिनाई होती है, उन्हें भी बारी और मदद मिली',
    },
    lookFor: {
      en: 'Watch the back rows and the children who did not raise their hands.',
      hi: 'पीछे की कतारों और उन बच्चों पर ध्यान दीजिए जिन्होंने हाथ नहीं उठाया।',
    },
    practices: ['small-group-rotation', 'paired-reading', 'wait-and-prompt'],
  },
  {
    code: 'mistakes-handled-kindly',
    area: 'inclusion',
    text: {
      en: 'Mistakes were corrected kindly',
      hi: 'गलतियों को प्यार से सुधारा गया',
    },
    lookFor: {
      en: 'No child was laughed at or scolded for a wrong answer; the child tried again.',
      hi: 'गलत उत्तर पर किसी बच्चे पर हँसा या डाँटा नहीं गया; बच्चे ने फिर कोशिश की।',
    },
    practices: ['wait-and-prompt'],
  },
  {
    code: 'thinking-time',
    area: 'inclusion',
    text: {
      en: 'Children had time to think before answering',
      hi: 'उत्तर देने से पहले बच्चों को सोचने का समय मिला',
    },
    lookFor: {
      en: 'A pause of a few seconds after a question before anyone is asked.',
      hi: 'प्रश्न के बाद किसी से पूछने से पहले कुछ सेकंड का ठहराव।',
    },
    practices: ['wait-and-prompt', 'open-questions'],
  },
  {
    code: 'children-talk-more',
    area: 'classroom',
    text: {
      en: 'Children talked more than the teacher in part of the lesson',
      hi: 'पाठ के कुछ हिस्से में बच्चे शिक्षक से ज़्यादा बोले',
    },
    lookFor: {
      en: 'Pair or group talk, children answering one another, not only the teacher explaining.',
      hi: 'जोड़ी या समूह में बातचीत, बच्चे एक-दूसरे को उत्तर दें, केवल शिक्षक का समझाना नहीं।',
    },
    practices: ['paired-reading', 'picture-talk', 'open-questions'],
  },
  {
    code: 'book-in-every-hand',
    area: 'classroom',
    text: {
      en: 'Every child had a book or something to read in hand',
      hi: 'हर बच्चे के हाथ में किताब या पढ़ने के लिए कुछ था',
    },
    lookFor: {
      en: "Books, cards or sheets with the children, not only on the teacher's table.",
      hi: 'किताबें, कार्ड या पन्ने बच्चों के पास, केवल शिक्षक की मेज़ पर नहीं।',
    },
    practices: ['reading-corner', 'paired-reading'],
  },
  {
    code: 'walls-in-use',
    area: 'classroom',
    text: {
      en: "Charts or a word wall at the children's eye level were used",
      hi: 'बच्चों की आँखों की ऊँचाई पर लगे चार्ट या शब्द-दीवार का उपयोग हुआ',
    },
    lookFor: {
      en: 'Children or the teacher pointed to the wall during the lesson.',
      hi: 'पाठ के दौरान बच्चों या शिक्षक ने दीवार की ओर इशारा करके उपयोग किया।',
    },
    practices: ['word-wall'],
  },
  {
    code: 'checks-understanding',
    area: 'classroom',
    text: {
      en: 'The teacher checked who had understood',
      hi: 'शिक्षक ने जाँचा कि किसे समझ आया',
    },
    lookFor: {
      en: 'A quick question to several children, a show of slates, or thumbs at the end.',
      hi: 'अंत में कई बच्चों से छोटा प्रश्न, स्लेट दिखाना, या अंगूठे से संकेत।',
    },
    practices: ['exit-check'],
  },
];

export function focusItem(code: string): FocusItem | undefined {
  return FOCUS_ITEMS.find((item) => item.code === code);
}

/** At most this many focus items are observed in one visit. */
export const FOCUS_ITEMS_PER_VISIT = 5;

export type MomentTone = 'strength' | 'concern';

export interface MomentTag {
  code: string;
  tone: MomentTone;
  text: LocalText;
}

export const MOMENT_TAGS: readonly MomentTag[] = [
  { code: 'good-question', tone: 'strength', text: { en: 'Good question', hi: 'अच्छा प्रश्न' } },
  { code: 'all-reading', tone: 'strength', text: { en: 'Everyone reading', hi: 'सब पढ़ रहे हैं' } },
  {
    code: 'child-helps-child',
    tone: 'strength',
    text: { en: 'Child helps child', hi: 'बच्चे ने साथी की मदद की' },
  },
  {
    code: 'effort-praised',
    tone: 'strength',
    text: { en: 'Effort praised', hi: 'मेहनत की तारीफ़' },
  },
  {
    code: 'english-sentence',
    tone: 'strength',
    text: { en: 'English sentence', hi: 'अंग्रेज़ी वाक्य' },
  },
  {
    code: 'home-language-used',
    tone: 'strength',
    text: { en: 'Home language used', hi: 'घर की भाषा का उपयोग' },
  },
  {
    code: 'group-left-out',
    tone: 'concern',
    text: { en: 'Group left out', hi: 'कुछ बच्चे छूट गए' },
  },
  {
    code: 'long-teacher-talk',
    tone: 'concern',
    text: { en: 'Long teacher talk', hi: 'शिक्षक देर तक बोले' },
  },
  { code: 'chorus-only', tone: 'concern', text: { en: 'Chorus only', hi: 'केवल सामूहिक दोहराना' } },
  { code: 'off-task', tone: 'concern', text: { en: 'Children off task', hi: 'बच्चे काम से हटे' } },
  {
    code: 'harsh-correction',
    tone: 'concern',
    text: { en: 'Harsh correction', hi: 'कठोर सुधार' },
  },
  {
    code: 'copying-only',
    tone: 'concern',
    text: { en: 'Copying from the board', hi: 'केवल बोर्ड से नकल' },
  },
];

export function momentTag(code: string): MomentTag | undefined {
  return MOMENT_TAGS.find((tag) => tag.code === code);
}
