import type { FocusArea, LocalText } from './observation-bank';

/**
 * The practices a CRP can agree on with a teacher: one at a time, each small enough to try the next
 * day. Every practice carries a ten-minute demonstration that the CRP gives in the class, built on
 * the textbook page the class is on (two minutes "I do", four "we do", four "you do"), a two-week
 * plan, and what to look for at the check-back.
 *
 * The practices are those of the NIPUN Bharat guidelines for foundational literacy and of teaching
 * at the right level: modelled and shared reading, reading in pairs and small groups, sound
 * awareness and blending, talk about meaning, oral English through pictures and sentence frames,
 * and the home language as a bridge. They are written for Classes 1 to 3 and need no material
 * beyond the textbook, the board and what a classroom already has.
 *
 * Codes are stored with each agreed step and never change; texts may be improved.
 */

export interface Practice {
  code: string;
  area: FocusArea;
  title: LocalText;
  /** Why the practice helps, in one or two sentences a teacher can repeat. */
  why: LocalText;
  /** The technique, as steps the teacher follows. */
  steps: readonly LocalText[];
  /** The ten-minute demonstration on today's page. */
  demo: { iDo: LocalText; weDo: LocalText; youDo: LocalText };
  /** The two weeks after the visit. */
  plan: readonly LocalText[];
  /** The focus item the next visit checks. */
  checkItem: string;
  /** What shows at the check-back that the practice has taken hold. */
  lookFor: LocalText;
}

export const PRACTICES: readonly Practice[] = [
  {
    code: 'echo-reading',
    area: 'reading',
    title: { en: 'Echo reading', hi: 'अनुकरण वाचन (गूँज पठन)' },
    why: {
      en: 'Children hear a fluent model of each line and then read it themselves, so they learn speed, pauses and expression, not only the letters.',
      hi: 'बच्चे हर पंक्ति को पहले सही गति और भाव से सुनते हैं, फिर स्वयं पढ़ते हैं। इससे वे केवल अक्षर नहीं, बल्कि गति, ठहराव और भाव भी सीखते हैं।',
    },
    steps: [
      {
        en: 'Read one line of today’s page aloud while pointing to each word.',
        hi: 'आज के पृष्ठ की एक पंक्ति हर शब्द पर उँगली रखते हुए पढ़िए।',
      },
      {
        en: 'The class reads the same line back, pointing in their own books.',
        hi: 'कक्षा वही पंक्ति अपनी किताब में उँगली रखकर दोहराती है।',
      },
      {
        en: 'Then a row, then two or three single children read it.',
        hi: 'फिर एक कतार के बच्चे, फिर दो-तीन बच्चे अकेले पढ़ते हैं।',
      },
      {
        en: 'Move to the next line; end with the whole page read by pairs.',
        hi: 'अगली पंक्ति पर जाइए; अंत में पूरा पृष्ठ जोड़ियों में पढ़वाइए।',
      },
    ],
    demo: {
      iDo: {
        en: 'Read the first two lines of today’s page at a natural speed, pointing to each word and pausing at every full stop.',
        hi: 'आज के पृष्ठ की पहली दो पंक्तियाँ सामान्य गति से पढ़िए, हर शब्द पर उँगली रखिए और हर पूर्ण विराम पर रुकिए।',
      },
      weDo: {
        en: 'The class echoes each line after you, then one row at a time. The teacher walks the rows and checks that fingers move with the words.',
        hi: 'कक्षा हर पंक्ति आपके बाद दोहराती है, फिर एक-एक कतार के बच्चे। शिक्षक कतारों के बीच घूमकर देखते हैं कि उँगलियाँ शब्दों के साथ चल रही हैं।',
      },
      youDo: {
        en: 'The teacher leads the next three lines while you watch; three children from the back rows read a line alone.',
        hi: 'अगली तीन पंक्तियाँ शिक्षक पढ़वाते हैं और आप देखते हैं; पीछे की कतारों के तीन बच्चे एक-एक पंक्ति अकेले पढ़ते हैं।',
      },
    },
    plan: [
      {
        en: 'Week 1: echo reading on the day’s page for ten minutes every day.',
        hi: 'पहला सप्ताह: हर दिन आज के पृष्ठ पर दस मिनट अनुकरण वाचन।',
      },
      {
        en: 'Week 2: shorten the echo to the hard lines and add two children reading alone each day.',
        hi: 'दूसरा सप्ताह: केवल कठिन पंक्तियों पर दोहराव, और हर दिन दो बच्चे अकेले पढ़ें।',
      },
    ],
    checkItem: 'teacher-models-reading',
    lookFor: {
      en: 'Children read a line alone with pauses at full stops, not word by word.',
      hi: 'बच्चे पंक्ति अकेले, पूर्ण विराम पर रुककर पढ़ते हैं, शब्द-शब्द अटककर नहीं।',
    },
  },
  {
    code: 'paired-reading',
    area: 'reading',
    title: { en: 'Paired reading', hi: 'जोड़ी में पठन' },
    why: {
      en: 'In pairs every child reads for several minutes instead of waiting for a turn, and a partner helps with hard words.',
      hi: 'जोड़ी में हर बच्चा बारी का इंतज़ार करने के बजाय कई मिनट पढ़ता है, और साथी कठिन शब्दों में मदद करता है।',
    },
    steps: [
      {
        en: 'Pair a more confident reader with a child who needs support; keep the pairs for two weeks.',
        hi: 'आत्मविश्वास से पढ़ने वाले बच्चे की जोड़ी उस बच्चे से बनाइए जिसे मदद चाहिए; दो सप्ताह तक जोड़ियाँ वही रखिए।',
      },
      {
        en: 'One partner reads a line, the other points and repeats; then they swap.',
        hi: 'एक साथी पंक्ति पढ़ता है, दूसरा उँगली रखकर दोहराता है; फिर वे अदला-बदली करते हैं।',
      },
      {
        en: 'On a hard word the partner waits five seconds, then gives the first sound, then the word.',
        hi: 'कठिन शब्द पर साथी पाँच सेकंड रुकता है, फिर पहली ध्वनि बताता है, फिर पूरा शब्द।',
      },
      {
        en: 'The teacher listens to two pairs each day and notes one word each child found hard.',
        hi: 'शिक्षक हर दिन दो जोड़ियों को सुनते हैं और हर बच्चे का एक कठिन शब्द लिखते हैं।',
      },
    ],
    demo: {
      iDo: {
        en: 'With one child as your partner, show the routine on today’s page: you read a line, the child echoes, you swap, and you wait before helping with a hard word.',
        hi: 'एक बच्चे को साथी बनाकर आज के पृष्ठ पर तरीका दिखाइए: आप पंक्ति पढ़ें, बच्चा दोहराए, फिर अदला-बदली करें, और कठिन शब्द पर मदद से पहले रुकें।',
      },
      weDo: {
        en: 'Make the pairs together with the teacher. All pairs read the first half of the page while you both listen to different pairs.',
        hi: 'शिक्षक के साथ मिलकर जोड़ियाँ बनाइए। सब जोड़ियाँ पृष्ठ का पहला आधा भाग पढ़ें और आप दोनों अलग-अलग जोड़ियों को सुनें।',
      },
      youDo: {
        en: 'The teacher runs the second half of the page alone and listens to the two pairs with the weakest readers.',
        hi: 'पृष्ठ का दूसरा आधा भाग शिक्षक अकेले करवाते हैं और सबसे कमज़ोर पाठकों वाली दो जोड़ियों को सुनते हैं।',
      },
    },
    plan: [
      {
        en: 'Week 1: ten minutes of paired reading on the day’s page, every day, same pairs.',
        hi: 'पहला सप्ताह: हर दिन उन्हीं जोड़ियों में आज के पृष्ठ पर दस मिनट पठन।',
      },
      {
        en: 'Week 2: add re-reading of yesterday’s page first; listen to two new pairs each day.',
        hi: 'दूसरा सप्ताह: पहले कल का पृष्ठ दोबारा पढ़वाइए; हर दिन दो नई जोड़ियों को सुनिए।',
      },
    ],
    checkItem: 'every-child-reads',
    lookFor: {
      en: 'Pairs start without being told how, and the weaker partner reads at least half the lines.',
      hi: 'जोड़ियाँ बिना बताए शुरू कर देती हैं, और कमज़ोर साथी कम से कम आधी पंक्तियाँ पढ़ता है।',
    },
  },
  {
    code: 'small-group-rotation',
    area: 'inclusion',
    title: { en: 'Small groups by reading level', hi: 'पढ़ने के स्तर के अनुसार छोटे समूह' },
    why: {
      en: 'Children who cannot yet read the page need work at their own level; a short daily group time with the teacher closes the gap faster than the whole-class lesson alone.',
      hi: 'जो बच्चे अभी पृष्ठ नहीं पढ़ पाते, उन्हें अपने स्तर का काम चाहिए; शिक्षक के साथ रोज़ थोड़ा समूह-समय पूरी कक्षा के पाठ से ज़्यादा तेज़ी से अंतर कम करता है।',
    },
    steps: [
      {
        en: 'Use the last Pulse and your own knowledge of the children to make three groups: needs support, hesitant and fluent.',
        hi: 'पिछले पल्स और बच्चों की अपनी जानकारी से तीन समूह बनाइए: मदद चाहिए, रुक-रुक कर पढ़ने वाले और धाराप्रवाह।',
      },
      {
        en: 'While two groups do a task on their own (copying words they can read, reading in pairs), sit with one group for ten minutes.',
        hi: 'जब दो समूह अपना काम स्वयं करें (पढ़े जा सकने वाले शब्द लिखना, जोड़ी में पढ़ना), तब एक समूह के साथ दस मिनट बैठिए।',
      },
      {
        en: 'Sit with the needs-support group first and most often.',
        hi: '"मदद चाहिए" वाले समूह के साथ सबसे पहले और सबसे ज़्यादा बैठिए।',
      },
      {
        en: 'Move a child up as soon as they read the next level without help.',
        hi: 'जैसे ही बच्चा अगला स्तर बिना मदद पढ़ ले, उसे ऊपर के समूह में भेजिए।',
      },
    ],
    demo: {
      iDo: {
        en: 'Seat the children who needed support in the last Pulse in a circle and run two minutes of sound-and-letter work with them.',
        hi: 'पिछले पल्स में जिन बच्चों को मदद चाहिए थी, उन्हें घेरे में बिठाइए और उनके साथ दो मिनट ध्वनि-अक्षर का काम कीजिए।',
      },
      weDo: {
        en: 'With the teacher, give the other two groups their tasks from today’s page, then both of you sit with the needs-support group.',
        hi: 'शिक्षक के साथ मिलकर बाकी दो समूहों को आज के पृष्ठ से उनका काम दीजिए, फिर आप दोनों "मदद चाहिए" वाले समूह के साथ बैठिए।',
      },
      youDo: {
        en: 'The teacher moves to the hesitant group and runs four minutes alone while you watch how the other groups keep working.',
        hi: 'शिक्षक रुक-रुक कर पढ़ने वाले समूह के पास जाकर चार मिनट अकेले काम करवाते हैं और आप देखते हैं कि बाकी समूह कैसे काम में लगे रहते हैं।',
      },
    },
    plan: [
      {
        en: 'Week 1: ten minutes a day with the needs-support group; the other groups have a fixed task.',
        hi: 'पहला सप्ताह: हर दिन दस मिनट "मदद चाहिए" वाले समूह के साथ; बाकी समूहों का एक तय काम।',
      },
      {
        en: 'Week 2: alternate days between the needs-support and the hesitant group; move up at least two children.',
        hi: 'दूसरा सप्ताह: एक दिन "मदद चाहिए", एक दिन रुक-रुक कर पढ़ने वाले समूह के साथ; कम से कम दो बच्चों को ऊपर भेजिए।',
      },
    ],
    checkItem: 'bottom-group-turns',
    lookFor: {
      en: 'The groups exist without being set up for the visit, and children of the needs-support group now read words.',
      hi: 'समूह मुलाक़ात के लिए अलग से नहीं बनाए गए, पहले से चल रहे हैं, और "मदद चाहिए" वाले समूह के बच्चे अब शब्द पढ़ते हैं।',
    },
  },
  {
    code: 'sound-blending',
    area: 'reading',
    title: { en: 'Blending sounds into words', hi: 'ध्वनियाँ जोड़कर शब्द पढ़ना' },
    why: {
      en: 'A child who can join sounds can read new words alone. Saying the sounds aloud and sliding them together is the step most early readers miss.',
      hi: 'जो बच्चा ध्वनियाँ जोड़ लेता है, वह नए शब्द स्वयं पढ़ सकता है। ध्वनियाँ बोलकर उन्हें मिलाना वह कदम है जो शुरुआती पाठक अक्सर छोड़ देते हैं।',
    },
    steps: [
      {
        en: 'Pick five short words from today’s page.',
        hi: 'आज के पृष्ठ से पाँच छोटे शब्द चुनिए।',
      },
      {
        en: 'Say each word in its sounds, slowly, with a hand movement for each sound; the class joins the sounds into the word.',
        hi: 'हर शब्द को उसकी ध्वनियों में धीरे-धीरे, हर ध्वनि पर हाथ का इशारा करते हुए बोलिए; कक्षा ध्वनियाँ जोड़कर शब्द बोलती है।',
      },
      {
        en: 'Then the reverse: say a word, the children break it into its sounds.',
        hi: 'फिर उल्टा: आप शब्द बोलिए, बच्चे उसे ध्वनियों में तोड़ें।',
      },
      {
        en: 'Finish by finding the five words on the page and reading them.',
        hi: 'अंत में वे पाँच शब्द पृष्ठ पर ढूँढकर पढ़वाइए।',
      },
    ],
    demo: {
      iDo: {
        en: 'Write two words from today’s page on the board, say their sounds one by one under your finger, and join them into the word.',
        hi: 'आज के पृष्ठ के दो शब्द बोर्ड पर लिखिए, उँगली रखते हुए उनकी ध्वनियाँ एक-एक करके बोलिए और जोड़कर शब्द बनाइए।',
      },
      weDo: {
        en: 'Three more words: you say the sounds, the class blends; then the class says the sounds and you blend, so they hear both directions.',
        hi: 'तीन और शब्द: आप ध्वनियाँ बोलें, कक्षा जोड़े; फिर कक्षा ध्वनियाँ बोले और आप जोड़ें, ताकि बच्चे दोनों दिशाएँ सुनें।',
      },
      youDo: {
        en: 'The teacher takes three new words; children who need support blend at least one alone.',
        hi: 'शिक्षक तीन नए शब्द लेते हैं; मदद चाहने वाले बच्चे कम से कम एक शब्द अकेले जोड़ते हैं।',
      },
    },
    plan: [
      {
        en: 'Week 1: five minutes of blending at the start of every reading lesson, with words from the day’s page.',
        hi: 'पहला सप्ताह: हर पठन पाठ की शुरुआत में आज के पृष्ठ के शब्दों से पाँच मिनट ध्वनि जोड़ना।',
      },
      {
        en: 'Week 2: add breaking words into sounds, and words with a matra or conjunct.',
        hi: 'दूसरा सप्ताह: शब्दों को ध्वनियों में तोड़ना जोड़िए, और मात्रा या संयुक्ताक्षर वाले शब्द भी।',
      },
    ],
    checkItem: 'sounds-before-letters',
    lookFor: {
      en: 'Children sound out an unknown word on their own before asking for help.',
      hi: 'बच्चे मदद माँगने से पहले अनजाने शब्द को स्वयं ध्वनियों में बोलकर पढ़ने की कोशिश करते हैं।',
    },
  },
  {
    code: 'letter-sound-games',
    area: 'reading',
    title: { en: 'Letter and sound games', hi: 'अक्षर और ध्वनि के खेल' },
    why: {
      en: 'Short, quick games give the many repetitions children need to know each letter by its sound, without the lesson becoming dull.',
      hi: 'छोटे और तेज़ खेल वह बार-बार का अभ्यास देते हैं जिससे बच्चे हर अक्षर को उसकी ध्वनि से पहचानते हैं, और पाठ उबाऊ भी नहीं होता।',
    },
    steps: [
      {
        en: 'Choose four letters from today’s page that the children confuse.',
        hi: 'आज के पृष्ठ से चार ऐसे अक्षर चुनिए जिनमें बच्चे गड़बड़ करते हैं।',
      },
      {
        en: 'Play "I say the sound, you show the letter" on slates or with fingers in the air.',
        hi: '"मैं ध्वनि बोलूँ, तुम अक्षर दिखाओ" खेल स्लेट पर या हवा में उँगली से खेलिए।',
      },
      {
        en: 'Play "find a word that starts with this sound" on the page.',
        hi: 'पृष्ठ पर "इस ध्वनि से शुरू होने वाला शब्द ढूँढो" खेलिए।',
      },
      {
        en: 'Keep it under five minutes and end while the children still want more.',
        hi: 'इसे पाँच मिनट से कम रखिए और तब खत्म कीजिए जब बच्चे और खेलना चाहें।',
      },
    ],
    demo: {
      iDo: {
        en: 'Show the "sound and letter" game with two letters from today’s page: say the sound, write the letter big in the air, the class watches.',
        hi: 'आज के पृष्ठ के दो अक्षरों से "ध्वनि और अक्षर" खेल दिखाइए: ध्वनि बोलिए, हवा में अक्षर बड़ा लिखिए, कक्षा देखे।',
      },
      weDo: {
        en: 'Play with four letters; children show on slates. The teacher and you look at the slates of the back rows.',
        hi: 'चार अक्षरों से खेलिए; बच्चे स्लेट पर दिखाएँ। शिक्षक और आप पीछे की कतारों की स्लेटें देखें।',
      },
      youDo: {
        en: 'The teacher runs "find a word on the page" for the same letters and asks the children who got the slate wrong first.',
        hi: 'शिक्षक उन्हीं अक्षरों के लिए "पृष्ठ पर शब्द ढूँढो" करवाते हैं और पहले उन बच्चों से पूछते हैं जिनकी स्लेट गलत थी।',
      },
    },
    plan: [
      {
        en: 'Week 1: one five-minute game every day with the four letters.',
        hi: 'पहला सप्ताह: उन्हीं चार अक्षरों से हर दिन पाँच मिनट का एक खेल।',
      },
      {
        en: 'Week 2: four new letters; mix in two from week 1.',
        hi: 'दूसरा सप्ताह: चार नए अक्षर; पहले सप्ताह के दो अक्षर भी मिलाइए।',
      },
    ],
    checkItem: 'sounds-before-letters',
    lookFor: {
      en: 'Most children show the right letter for a sound without looking at a neighbour.',
      hi: 'ज़्यादातर बच्चे बिना पड़ोसी की ओर देखे ध्वनि का सही अक्षर दिखाते हैं।',
    },
  },
  {
    code: 'read-aloud-think-aloud',
    area: 'reading',
    title: { en: 'Read aloud and think aloud', hi: 'पढ़कर सुनाना और सोचकर बोलना' },
    why: {
      en: 'When the teacher reads with expression and says aloud what they wonder or picture, children learn that reading is about meaning, and how to think while reading.',
      hi: 'जब शिक्षक भाव के साथ पढ़ते हैं और बोलकर बताते हैं कि वे क्या सोच रहे हैं या कल्पना कर रहे हैं, तो बच्चे सीखते हैं कि पढ़ना अर्थ समझने के लिए है और पढ़ते समय कैसे सोचा जाता है।',
    },
    steps: [
      {
        en: 'Read today’s story or poem aloud once, with expression, while the children only listen.',
        hi: 'आज की कहानी या कविता एक बार भाव के साथ पढ़कर सुनाइए, बच्चे केवल सुनें।',
      },
      {
        en: 'Read it again and stop two or three times to say what you think: "I wonder why…", "I can picture…".',
        hi: 'दोबारा पढ़िए और दो-तीन बार रुककर बताइए कि आप क्या सोच रहे हैं: "मुझे जानना है कि क्यों…", "मुझे दिख रहा है…"।',
      },
      {
        en: 'At the next stop, ask the children what they think.',
        hi: 'अगली बार रुकने पर बच्चों से पूछिए कि वे क्या सोचते हैं।',
      },
    ],
    demo: {
      iDo: {
        en: 'Read today’s text aloud with expression and stop once to think aloud about a character or a picture.',
        hi: 'आज का पाठ भाव के साथ पढ़कर सुनाइए और एक बार रुककर किसी पात्र या चित्र के बारे में सोचकर बोलिए।',
      },
      weDo: {
        en: 'Read on; at two stops ask "what do you think will happen?" and take answers from children who have not spoken yet.',
        hi: 'आगे पढ़िए; दो जगह रुककर पूछिए "तुम्हें क्या लगता है आगे क्या होगा?" और उन बच्चों से उत्तर लीजिए जो अभी तक नहीं बोले।',
      },
      youDo: {
        en: 'The teacher reads the last part and makes one think-aloud stop of their own.',
        hi: 'अंतिम भाग शिक्षक पढ़ते हैं और स्वयं एक जगह रुककर सोचकर बोलते हैं।',
      },
    },
    plan: [
      {
        en: 'Week 1: start every new lesson with a read-aloud before the children read.',
        hi: 'पहला सप्ताह: हर नया पाठ बच्चों के पढ़ने से पहले पढ़कर सुनाने से शुरू कीजिए।',
      },
      {
        en: 'Week 2: add two think-aloud stops and one question to the children each time.',
        hi: 'दूसरा सप्ताह: हर बार दो जगह सोचकर बोलिए और बच्चों से एक प्रश्न पूछिए।',
      },
    ],
    checkItem: 'reads-for-meaning',
    lookFor: {
      en: 'Children offer their own guesses and reasons about the text.',
      hi: 'बच्चे पाठ के बारे में अपने अनुमान और कारण स्वयं बताते हैं।',
    },
  },
  {
    code: 'open-questions',
    area: 'reading',
    title: { en: 'Questions that make children think', hi: 'सोच जगाने वाले प्रश्न' },
    why: {
      en: 'Questions with one word from the text as the answer check memory; "why" and "what would you do" questions build understanding and talk.',
      hi: 'जिन प्रश्नों का उत्तर पाठ का एक शब्द हो, वे केवल याददाश्त जाँचते हैं; "क्यों" और "तुम क्या करते" वाले प्रश्न समझ और बातचीत बढ़ाते हैं।',
    },
    steps: [
      {
        en: 'Before the lesson, write two "why" or "what if" questions about today’s page.',
        hi: 'पाठ से पहले आज के पृष्ठ के बारे में "क्यों" या "अगर ऐसा होता तो" वाले दो प्रश्न लिख लीजिए।',
      },
      {
        en: 'Ask, then wait five seconds before anyone answers.',
        hi: 'प्रश्न पूछिए, फिर किसी के उत्तर देने से पहले पाँच सेकंड रुकिए।',
      },
      {
        en: 'Let children tell a partner first, then take answers from three pairs.',
        hi: 'बच्चों को पहले अपने साथी को बताने दीजिए, फिर तीन जोड़ियों से उत्तर लीजिए।',
      },
      {
        en: 'Ask "why do you think so?" after every answer, right or wrong.',
        hi: 'हर उत्तर के बाद, सही हो या गलत, पूछिए "तुम्हें ऐसा क्यों लगता है?"',
      },
    ],
    demo: {
      iDo: {
        en: 'Ask one "why" question about today’s page, wait in silence, and show the class how you think about it out loud.',
        hi: 'आज के पृष्ठ के बारे में एक "क्यों" वाला प्रश्न पूछिए, चुप रहकर रुकिए, और कक्षा को बोलकर दिखाइए कि आप उस पर कैसे सोचते हैं।',
      },
      weDo: {
        en: 'Ask a second question; pairs talk for one minute; you and the teacher listen to pairs and pick three to share.',
        hi: 'दूसरा प्रश्न पूछिए; जोड़ियाँ एक मिनट बात करें; आप और शिक्षक जोड़ियों को सुनें और तीन को सुनाने के लिए चुनें।',
      },
      youDo: {
        en: 'The teacher asks a question of their own and follows each answer with "why do you think so?".',
        hi: 'शिक्षक अपना एक प्रश्न पूछते हैं और हर उत्तर के बाद पूछते हैं "तुम्हें ऐसा क्यों लगता है?"',
      },
    },
    plan: [
      {
        en: 'Week 1: two thinking questions in every reading lesson, with wait time and partner talk.',
        hi: 'पहला सप्ताह: हर पठन पाठ में प्रतीक्षा-समय और साथी से बातचीत के साथ दो सोचने वाले प्रश्न।',
      },
      {
        en: 'Week 2: let children ask one question of their own about the page.',
        hi: 'दूसरा सप्ताह: बच्चों को पृष्ठ के बारे में अपना एक प्रश्न पूछने दीजिए।',
      },
    ],
    checkItem: 'reads-for-meaning',
    lookFor: {
      en: 'Answers of more than one word, and children giving reasons.',
      hi: 'एक शब्द से लंबे उत्तर, और बच्चे कारण बताते हुए।',
    },
  },
  {
    code: 'wait-and-prompt',
    area: 'inclusion',
    title: { en: 'Wait, prompt, praise', hi: 'रुकिए, संकेत दीजिए, सराहिए' },
    why: {
      en: 'A child stuck on a word learns most when given time and a small hint, not the answer; praise for the effort keeps the shy child trying.',
      hi: 'शब्द पर अटका बच्चा सबसे ज़्यादा तब सीखता है जब उसे समय और छोटा संकेत मिले, उत्तर नहीं; मेहनत की सराहना संकोची बच्चे को कोशिश करते रहने देती है।',
    },
    steps: [
      {
        en: 'When a child stops, wait five seconds without speaking.',
        hi: 'जब बच्चा रुके, तो बिना बोले पाँच सेकंड रुकिए।',
      },
      {
        en: 'Then prompt: the first sound, or "look at the picture", or "read it again from the start".',
        hi: 'फिर संकेत दीजिए: पहली ध्वनि, या "चित्र देखो", या "शुरू से फिर पढ़ो"।',
      },
      {
        en: 'Give the word only after two prompts; let the child read the whole line again.',
        hi: 'दो संकेतों के बाद ही शब्द बताइए; बच्चे से पूरी पंक्ति फिर पढ़वाइए।',
      },
      {
        en: 'Praise what the child did: "you looked at the first letter".',
        hi: 'बच्चे ने जो किया उसकी तारीफ़ कीजिए: "तुमने पहला अक्षर देखा"।',
      },
    ],
    demo: {
      iDo: {
        en: 'Listen to one child read today’s page; when they stop, show the wait, the prompt and the praise for the class to see.',
        hi: 'एक बच्चे से आज का पृष्ठ पढ़वाइए; जब वह रुके, तो कक्षा के सामने रुकना, संकेत देना और सराहना करना दिखाइए।',
      },
      weDo: {
        en: 'The teacher listens to two children while you stand by and point out the moment to wait.',
        hi: 'शिक्षक दो बच्चों को सुनते हैं और आप पास खड़े रहकर बताते हैं कि कब रुकना है।',
      },
      youDo: {
        en: 'The teacher listens to two more children from the back rows alone.',
        hi: 'शिक्षक पीछे की कतारों के दो और बच्चों को अकेले सुनते हैं।',
      },
    },
    plan: [
      {
        en: 'Week 1: use wait-prompt-praise with every child who reads alone.',
        hi: 'पहला सप्ताह: अकेले पढ़ने वाले हर बच्चे के साथ रुकिए-संकेत-सराहिए अपनाइए।',
      },
      {
        en: 'Week 2: teach the class to do the same for a partner in paired reading.',
        hi: 'दूसरा सप्ताह: जोड़ी पठन में कक्षा को भी साथी के लिए यही करना सिखाइए।',
      },
    ],
    checkItem: 'mistakes-handled-kindly',
    lookFor: {
      en: 'Children are given time and hints, and nobody calls out the answer over them.',
      hi: 'बच्चों को समय और संकेत मिलते हैं, और कोई दूसरा बीच में उत्तर नहीं चिल्लाता।',
    },
  },
  {
    code: 'shared-writing',
    area: 'reading',
    title: { en: 'Writing together, then alone', hi: 'साथ में लिखना, फिर अकेले' },
    why: {
      en: 'Children learn to write their own words when they first watch the teacher put the class’s ideas on the board, then try one line of their own.',
      hi: 'बच्चे अपने शब्द लिखना तब सीखते हैं जब वे पहले शिक्षक को कक्षा के विचार बोर्ड पर लिखते देखें, फिर अपनी एक पंक्ति लिखने की कोशिश करें।',
    },
    steps: [
      {
        en: 'Take one idea from today’s page ("what did the cat do next?") and collect answers from the class.',
        hi: 'आज के पृष्ठ से एक बात लीजिए ("बिल्ली ने आगे क्या किया?") और कक्षा से उत्तर लीजिए।',
      },
      {
        en: 'Write one answer on the board, saying the sounds of each word as you write it.',
        hi: 'एक उत्तर बोर्ड पर लिखिए, हर शब्द लिखते समय उसकी ध्वनियाँ बोलते हुए।',
      },
      {
        en: 'Children write their own answer of one line or one word with a drawing.',
        hi: 'बच्चे अपना उत्तर एक पंक्ति में, या चित्र के साथ एक शब्द में लिखते हैं।',
      },
      {
        en: 'Accept invented spellings; ask the child to read what they wrote.',
        hi: 'अपनी तरह की वर्तनी भी स्वीकार कीजिए; बच्चे से पढ़वाइए कि उसने क्या लिखा।',
      },
    ],
    demo: {
      iDo: {
        en: 'Ask the class one question about today’s page and write one child’s answer on the board, sounding out every word.',
        hi: 'आज के पृष्ठ पर कक्षा से एक प्रश्न पूछिए और एक बच्चे का उत्तर हर शब्द की ध्वनियाँ बोलते हुए बोर्ड पर लिखिए।',
      },
      weDo: {
        en: 'Write a second sentence together: children say the sounds, you write.',
        hi: 'दूसरा वाक्य साथ में लिखिए: बच्चे ध्वनियाँ बोलें, आप लिखें।',
      },
      youDo: {
        en: 'Children write their own line on slates or in notebooks; the teacher asks five children to read theirs.',
        hi: 'बच्चे स्लेट या कॉपी में अपनी पंक्ति लिखते हैं; शिक्षक पाँच बच्चों से उनका लिखा पढ़वाते हैं।',
      },
    },
    plan: [
      {
        en: 'Week 1: one shared sentence and one line of their own, three times in the week.',
        hi: 'पहला सप्ताह: सप्ताह में तीन बार एक साझा वाक्य और एक अपनी पंक्ति।',
      },
      {
        en: 'Week 2: two lines of their own; display some on the wall.',
        hi: 'दूसरा सप्ताह: अपनी दो पंक्तियाँ; कुछ को दीवार पर लगाइए।',
      },
    ],
    checkItem: 'children-write',
    lookFor: {
      en: 'Notebooks show lines the children made up, not only copied text.',
      hi: 'कॉपियों में बच्चों की अपनी बनाई पंक्तियाँ हैं, केवल नकल किया गया पाठ नहीं।',
    },
  },
  {
    code: 'picture-talk',
    area: 'english',
    title: { en: 'Picture talk in English', hi: 'चित्र पर अंग्रेज़ी में बातचीत' },
    why: {
      en: 'A picture gives children something to say. Talking about it in short English sentences builds the speaking that reading English depends on.',
      hi: 'चित्र बच्चों को बोलने के लिए कुछ देता है। उस पर छोटे अंग्रेज़ी वाक्यों में बात करना वह बोलचाल बनाता है जिस पर अंग्रेज़ी पढ़ना टिका है।',
    },
    steps: [
      {
        en: 'Use the picture on today’s page, or any picture in the classroom.',
        hi: 'आज के पृष्ठ का चित्र, या कक्षा का कोई भी चित्र लीजिए।',
      },
      {
        en: 'Ask "What can you see?" and accept single words first.',
        hi: 'पूछिए "What can you see?" और पहले एक-एक शब्द के उत्तर स्वीकार कीजिए।',
      },
      {
        en: 'Turn each word into a sentence with the child: "a dog" → "I can see a dog."',
        hi: 'बच्चे के साथ हर शब्द को वाक्य बनाइए: "a dog" → "I can see a dog."',
      },
      {
        en: 'Then ask "Where is…?", "What is … doing?" and let pairs ask each other.',
        hi: 'फिर पूछिए "Where is…?", "What is … doing?" और जोड़ियों को एक-दूसरे से पूछने दीजिए।',
      },
    ],
    demo: {
      iDo: {
        en: 'Hold up the picture on today’s page and describe it in three short English sentences, pointing to each thing.',
        hi: 'आज के पृष्ठ का चित्र दिखाइए और हर चीज़ की ओर इशारा करते हुए उसे तीन छोटे अंग्रेज़ी वाक्यों में बताइए।',
      },
      weDo: {
        en: 'Ask "What can you see?"; turn the children’s words into sentences that the class repeats.',
        hi: '"What can you see?" पूछिए; बच्चों के शब्दों को वाक्य बनाइए जिन्हें कक्षा दोहराए।',
      },
      youDo: {
        en: 'Pairs ask each other "What can you see?" and answer in a sentence; the teacher listens to three pairs.',
        hi: 'जोड़ियाँ एक-दूसरे से "What can you see?" पूछती हैं और वाक्य में उत्तर देती हैं; शिक्षक तीन जोड़ियों को सुनते हैं।',
      },
    },
    plan: [
      {
        en: 'Week 1: five minutes of picture talk at the start of every English lesson.',
        hi: 'पहला सप्ताह: हर अंग्रेज़ी पाठ की शुरुआत में पाँच मिनट चित्र पर बातचीत।',
      },
      {
        en: 'Week 2: pairs ask each other; add "Where is…?" and "What is … doing?".',
        hi: 'दूसरा सप्ताह: जोड़ियाँ एक-दूसरे से पूछें; "Where is…?" और "What is … doing?" जोड़िए।',
      },
    ],
    checkItem: 'english-own-sentences',
    lookFor: {
      en: 'Children say a full English sentence about a picture without repeating after the teacher.',
      hi: 'बच्चे शिक्षक के पीछे दोहराए बिना चित्र के बारे में पूरा अंग्रेज़ी वाक्य बोलते हैं।',
    },
  },
  {
    code: 'sentence-frames',
    area: 'english',
    title: { en: 'English sentence frames', hi: 'अंग्रेज़ी वाक्य-ढाँचे' },
    why: {
      en: 'A frame such as "I like … because …" lets a beginner make a sentence of their own by changing one or two words.',
      hi: '"I like … because …" जैसा ढाँचा शुरुआती बच्चे को एक-दो शब्द बदलकर अपना वाक्य बनाने देता है।',
    },
    steps: [
      {
        en: 'Write one frame on the board linked to today’s lesson: "This is a …", "I can …", "I like …".',
        hi: 'आज के पाठ से जुड़ा एक ढाँचा बोर्ड पर लिखिए: "This is a …", "I can …", "I like …"।',
      },
      {
        en: 'Say three sentences with it yourself, changing the missing word.',
        hi: 'खाली शब्द बदलते हुए स्वयं तीन वाक्य बोलिए।',
      },
      {
        en: 'Every child says one sentence with the frame to a partner, then a few to the class.',
        hi: 'हर बच्चा ढाँचे से एक वाक्य अपने साथी को बोले, फिर कुछ बच्चे पूरी कक्षा को।',
      },
      {
        en: 'Keep the frame on the board for the week and add a second one.',
        hi: 'ढाँचा पूरे सप्ताह बोर्ड पर रहने दीजिए और फिर दूसरा जोड़िए।',
      },
    ],
    demo: {
      iDo: {
        en: 'Write "I can see a …" next to today’s picture and say three sentences, pointing each time.',
        hi: 'आज के चित्र के पास "I can see a …" लिखिए और हर बार इशारा करते हुए तीन वाक्य बोलिए।',
      },
      weDo: {
        en: 'The class finishes the frame with words from the picture; you and the teacher help children from the back rows.',
        hi: 'कक्षा चित्र के शब्दों से ढाँचा पूरा करती है; आप और शिक्षक पीछे की कतारों के बच्चों की मदद करते हैं।',
      },
      youDo: {
        en: 'The teacher writes a second frame ("I like … because …") and runs partner talk alone.',
        hi: 'शिक्षक दूसरा ढाँचा ("I like … because …") लिखते हैं और जोड़ियों में बातचीत अकेले करवाते हैं।',
      },
    },
    plan: [
      {
        en: 'Week 1: one frame, used in every English lesson; each child says a sentence daily.',
        hi: 'पहला सप्ताह: एक ढाँचा, हर अंग्रेज़ी पाठ में; हर बच्चा रोज़ एक वाक्य बोले।',
      },
      {
        en: 'Week 2: a second frame; children combine the two.',
        hi: 'दूसरा सप्ताह: दूसरा ढाँचा; बच्चे दोनों को मिलाएँ।',
      },
    ],
    checkItem: 'english-own-sentences',
    lookFor: {
      en: 'Children change the frame’s words on their own and make new sentences.',
      hi: 'बच्चे ढाँचे के शब्द स्वयं बदलकर नए वाक्य बनाते हैं।',
    },
  },
  {
    code: 'home-language-bridge',
    area: 'english',
    title: { en: 'A bridge from the home language', hi: 'घर की भाषा से पुल' },
    why: {
      en: 'Children understand a new word fastest when it is linked to the word they use at home; the home language is a help, not a mistake.',
      hi: 'बच्चे नया शब्द सबसे जल्दी तब समझते हैं जब उसे उस शब्द से जोड़ा जाए जो वे घर पर बोलते हैं; घर की भाषा मदद है, गलती नहीं।',
    },
    steps: [
      {
        en: 'Pick three new words from today’s page.',
        hi: 'आज के पृष्ठ से तीन नए शब्द चुनिए।',
      },
      {
        en: 'Ask the children what they call it at home; write both words side by side.',
        hi: 'बच्चों से पूछिए कि घर पर वे इसे क्या कहते हैं; दोनों शब्द साथ-साथ लिखिए।',
      },
      {
        en: 'Let children explain the meaning in their own language first, then say it in the lesson’s language.',
        hi: 'बच्चों को पहले अपनी भाषा में अर्थ समझाने दीजिए, फिर पाठ की भाषा में बोलने दीजिए।',
      },
    ],
    demo: {
      iDo: {
        en: 'Take one new word from today’s page, ask what it is called at home, and write the two words side by side.',
        hi: 'आज के पृष्ठ से एक नया शब्द लीजिए, पूछिए कि घर पर इसे क्या कहते हैं, और दोनों शब्द साथ-साथ लिखिए।',
      },
      weDo: {
        en: 'Two more words; children from different homes share their words; the class uses each new word in a sentence.',
        hi: 'दो और शब्द; अलग-अलग घरों के बच्चे अपने शब्द बताएँ; कक्षा हर नए शब्द को वाक्य में बोले।',
      },
      youDo: {
        en: 'The teacher takes the next new word on the page in the same way.',
        hi: 'शिक्षक पृष्ठ का अगला नया शब्द इसी तरह लेते हैं।',
      },
    },
    plan: [
      {
        en: 'Week 1: a two-language word list on the wall for every new lesson.',
        hi: 'पहला सप्ताह: हर नए पाठ के लिए दीवार पर दो भाषाओं की शब्द-सूची।',
      },
      {
        en: 'Week 2: children add words from home to the list themselves.',
        hi: 'दूसरा सप्ताह: बच्चे स्वयं घर के शब्द सूची में जोड़ें।',
      },
    ],
    checkItem: 'home-language-bridge',
    lookFor: {
      en: 'The two-language list is on the wall and children use it.',
      hi: 'दो भाषाओं वाली सूची दीवार पर है और बच्चे उसका उपयोग करते हैं।',
    },
  },
  {
    code: 'reading-corner',
    area: 'classroom',
    title: { en: 'A reading corner children use', hi: 'बच्चों के उपयोग वाला पठन कोना' },
    why: {
      en: 'Children become readers by handling many short books and cards, not only the textbook; a corner within their reach makes it a daily habit.',
      hi: 'बच्चे केवल पाठ्यपुस्तक से नहीं, बहुत सी छोटी किताबें और कार्ड हाथ में लेकर पाठक बनते हैं; उनकी पहुँच में रखा कोना इसे रोज़ की आदत बनाता है।',
    },
    steps: [
      {
        en: 'Put the school’s storybooks, old textbooks and word cards at the children’s height.',
        hi: 'स्कूल की कहानी की किताबें, पुरानी पाठ्यपुस्तकें और शब्द-कार्ड बच्चों की ऊँचाई पर रखिए।',
      },
      {
        en: 'Give fifteen minutes a week where every child picks something to read.',
        hi: 'सप्ताह में पंद्रह मिनट दीजिए जिसमें हर बच्चा पढ़ने के लिए कुछ चुने।',
      },
      {
        en: 'Let children take a book home and tell the class about it.',
        hi: 'बच्चों को किताब घर ले जाने दीजिए और कक्षा को उसके बारे में बताने दीजिए।',
      },
    ],
    demo: {
      iDo: {
        en: 'Set up the corner with the books the school has, and show how to pick a book, look at the pictures and read the first page.',
        hi: 'स्कूल में उपलब्ध किताबों से कोना सजाइए, और दिखाइए कि किताब कैसे चुनें, चित्र कैसे देखें और पहला पृष्ठ कैसे पढ़ें।',
      },
      weDo: {
        en: 'Children choose a book in turns while you and the teacher help the youngest readers pick books with pictures.',
        hi: 'बच्चे बारी-बारी किताब चुनते हैं और आप तथा शिक्षक सबसे छोटे पाठकों को चित्रों वाली किताबें चुनने में मदद करते हैं।',
      },
      youDo: {
        en: 'The teacher asks three children to tell the class one thing from the book they chose.',
        hi: 'शिक्षक तीन बच्चों से कहते हैं कि वे अपनी चुनी किताब की एक बात कक्षा को बताएँ।',
      },
    },
    plan: [
      {
        en: 'Week 1: set up the corner and hold the first fifteen minutes of free reading.',
        hi: 'पहला सप्ताह: कोना सजाइए और पंद्रह मिनट का पहला स्वतंत्र पठन रखिए।',
      },
      {
        en: 'Week 2: start lending books home with a simple list.',
        hi: 'दूसरा सप्ताह: एक सरल सूची के साथ किताबें घर देना शुरू कीजिए।',
      },
    ],
    checkItem: 'book-in-every-hand',
    lookFor: {
      en: 'The corner is within reach and the books show signs of being used.',
      hi: 'कोना बच्चों की पहुँच में है और किताबें उपयोग में दिखती हैं।',
    },
  },
  {
    code: 'word-wall',
    area: 'classroom',
    title: { en: 'A word wall that is used', hi: 'उपयोग में आने वाली शब्द-दीवार' },
    why: {
      en: 'Words the class has learnt, on the wall at eye level, become a help children look at while reading and writing, if the lesson keeps using them.',
      hi: 'कक्षा के सीखे शब्द आँखों की ऊँचाई पर दीवार पर हों और पाठ में उनका उपयोग होता रहे, तो वे पढ़ते-लिखते समय बच्चों की मदद बनते हैं।',
    },
    steps: [
      {
        en: 'Add three or four words from each new lesson, large and clear, at the children’s eye level.',
        hi: 'हर नए पाठ से तीन-चार शब्द बड़े और साफ़ अक्षरों में बच्चों की आँखों की ऊँचाई पर जोड़िए।',
      },
      {
        en: 'Group them by their first letter or sound.',
        hi: 'उन्हें पहले अक्षर या ध्वनि के अनुसार समूह में रखिए।',
      },
      {
        en: 'Use the wall every day: "find a word that starts like…", "read the words of this week".',
        hi: 'हर दिन दीवार का उपयोग कीजिए: "ऐसा शब्द ढूँढो जो … से शुरू हो", "इस सप्ताह के शब्द पढ़ो"।',
      },
    ],
    demo: {
      iDo: {
        en: 'Write three words from today’s page on cards, read them, and put them on the wall under their first letters.',
        hi: 'आज के पृष्ठ के तीन शब्द कार्ड पर लिखिए, पढ़िए, और उनके पहले अक्षर के नीचे दीवार पर लगाइए।',
      },
      weDo: {
        en: 'Play "find a word that starts with…" at the wall with the class.',
        hi: 'कक्षा के साथ दीवार पर "… से शुरू होने वाला शब्द ढूँढो" खेलिए।',
      },
      youDo: {
        en: 'The teacher adds the next word and asks children to use wall words in a sentence.',
        hi: 'शिक्षक अगला शब्द जोड़ते हैं और बच्चों से दीवार के शब्दों को वाक्य में बोलने को कहते हैं।',
      },
    },
    plan: [
      {
        en: 'Week 1: three words a lesson on the wall; two minutes of wall reading a day.',
        hi: 'पहला सप्ताह: हर पाठ के तीन शब्द दीवार पर; रोज़ दो मिनट दीवार पठन।',
      },
      {
        en: 'Week 2: children find wall words when they write.',
        hi: 'दूसरा सप्ताह: लिखते समय बच्चे दीवार के शब्द ढूँढें।',
      },
    ],
    checkItem: 'walls-in-use',
    lookFor: {
      en: 'Children look at or point to the wall while reading or writing.',
      hi: 'पढ़ते या लिखते समय बच्चे दीवार की ओर देखते या इशारा करते हैं।',
    },
  },
  {
    code: 'exit-check',
    area: 'classroom',
    title: { en: 'A two-minute check at the end', hi: 'अंत में दो मिनट की जाँच' },
    why: {
      en: 'A quick check of every child at the end shows who needs help tomorrow, before the gap grows.',
      hi: 'अंत में हर बच्चे की छोटी सी जाँच बता देती है कि कल किसे मदद चाहिए, इससे पहले कि अंतर बढ़ जाए।',
    },
    steps: [
      {
        en: 'In the last two minutes, give one small task from today’s page: read this word, write this sound.',
        hi: 'आख़िरी दो मिनट में आज के पृष्ठ से एक छोटा काम दीजिए: यह शब्द पढ़ो, यह ध्वनि लिखो।',
      },
      {
        en: 'Children show slates together or read the word to the teacher one by one at the door.',
        hi: 'बच्चे एक साथ स्लेट दिखाएँ या दरवाज़े पर एक-एक करके शिक्षक को शब्द पढ़कर सुनाएँ।',
      },
      {
        en: 'Note the names of those who could not; start with them tomorrow.',
        hi: 'जो नहीं कर पाए उनके नाम लिखिए; कल उन्हीं से शुरू कीजिए।',
      },
    ],
    demo: {
      iDo: {
        en: 'Pick one word from today’s page and show the class how the check works: write it, show slates on "one, two, three".',
        hi: 'आज के पृष्ठ से एक शब्द चुनिए और कक्षा को दिखाइए कि जाँच कैसे होती है: लिखो, "एक, दो, तीन" पर स्लेट दिखाओ।',
      },
      weDo: {
        en: 'Run the check together; you and the teacher each look at half the slates and note names.',
        hi: 'जाँच साथ में कीजिए; आप और शिक्षक आधी-आधी स्लेटें देखकर नाम लिखिए।',
      },
      youDo: {
        en: 'The teacher runs a second check with a different word and decides who to start with tomorrow.',
        hi: 'शिक्षक दूसरे शब्द से फिर जाँच करते हैं और तय करते हैं कि कल किससे शुरू करना है।',
      },
    },
    plan: [
      {
        en: 'Week 1: an exit check at the end of every reading lesson; a list of names to start with.',
        hi: 'पहला सप्ताह: हर पठन पाठ के अंत में जाँच; शुरुआत के लिए नामों की सूची।',
      },
      {
        en: 'Week 2: begin each lesson with five minutes for the children on the list.',
        hi: 'दूसरा सप्ताह: हर पाठ की शुरुआत सूची वाले बच्चों के साथ पाँच मिनट से कीजिए।',
      },
    ],
    checkItem: 'checks-understanding',
    lookFor: {
      en: 'The teacher has a list of names from the last check and starts with them.',
      hi: 'शिक्षक के पास पिछली जाँच के नामों की सूची है और वे उन्हीं से शुरू करते हैं।',
    },
  },
];

export function practice(code: string): Practice | undefined {
  return PRACTICES.find((entry) => entry.code === code);
}
