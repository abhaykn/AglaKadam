import type { Grade, ReadingLanguage } from '@/features/pulse/item-bank';

/**
 * Reading practice for home, written for this application. None of it is used in Pulse checks:
 * the stories, and the words to read, are kept apart from the check's passages, words and spoken
 * English keywords (the tests in `practice.test.ts` make sure of it), so practising at home never
 * teaches a child
 * the answers to a check. Letters are the alphabet, which is what a child is meant to learn.
 */

export interface PracticeStory {
  code: string;
  text: string;
  question: string;
  /** The first choice is the right answer; choices are shuffled when shown. */
  choices: [string, string, string];
}

type StorySource = [text: string, question: string, choices: [string, string, string]];

const HINDI_STORIES: Record<Grade, readonly StorySource[]> = {
  1: [
    [
      'चिंटू के पास एक छोटी बकरी है। बकरी सफेद है। वह हरी घास खाती है। चिंटू उसे रोज पानी देता है।',
      'बकरी क्या खाती है?',
      ['हरी घास', 'रोटी', 'चावल'],
    ],
    [
      'आज रविवार है। पापा एक पीली पतंग लाए। हम सब छत पर गए। पतंग हवा में ऊपर तक उड़ी।',
      'पतंग किस रंग की है?',
      ['पीली', 'लाल', 'नीली'],
    ],
    [
      'नीना ने बगीचे में एक लाल फूल देखा। फूल पर एक तितली बैठी थी। तितली के पंख रंगीन थे। नीना खुश हो गई।',
      'फूल पर कौन बैठी थी?',
      ['तितली', 'चिड़िया', 'मक्खी'],
    ],
    [
      'मेरे पास एक नई किताब है। उसमें सुंदर चित्र हैं। मैं रात को माँ के साथ किताब पढ़ती हूँ।',
      'किताब में क्या हैं?',
      ['सुंदर चित्र', 'खिलौने', 'फल'],
    ],
    [
      'गोलू को आम बहुत पसंद है। गर्मी में आम पकते हैं। दादी गोलू के लिए मीठे आम लाईं। गोलू ने सबको आम बाँटे।',
      'गोलू को क्या पसंद है?',
      ['आम', 'केला', 'अमरूद'],
    ],
    [
      'हमारे स्कूल में एक घंटी है। घंटी बजी तो सब बच्चे कक्षा में आए। दीदी ने सबको नमस्ते कहा।',
      'घंटी बजी तो बच्चे कहाँ आए?',
      ['कक्षा में', 'घर पर', 'बाजार में'],
    ],
  ],
  2: [
    [
      'सलीम के घर के पास बरगद का एक बड़ा पेड़ है। गर्मी की दोपहर में गाँव के बच्चे उसकी छाँव में खेलते हैं। पेड़ की डालियों पर बहुत सी चिड़ियाँ रहती हैं। शाम को चिड़ियाँ चहचहाती हैं तो सलीम को बहुत अच्छा लगता है।',
      'बच्चे दोपहर में कहाँ खेलते हैं?',
      ['पेड़ की छाँव में', 'नदी में', 'छत पर'],
    ],
    [
      'अनु की माँ सब्जी बेचती हैं। सुबह अनु माँ के साथ ठेला सजाती है। ठेले पर टमाटर, आलू और हरी मिर्च होती हैं। अनु पैसे गिनना जानती है, इसलिए वह माँ की मदद करती है। फिर वह समय पर स्कूल चली जाती है।',
      'अनु माँ की मदद कैसे करती है?',
      ['पैसे गिनकर', 'खाना बनाकर', 'गाना गाकर'],
    ],
    [
      'एक दिन कक्षा में एक छोटी गिलहरी आ गई। सब बच्चे चुप होकर उसे देखने लगे। गिलहरी ने इधर उधर देखा और खिड़की पर चढ़ गई। गुरुजी ने कहा कि हमें जानवरों को डराना नहीं चाहिए। थोड़ी देर में गिलहरी पेड़ पर लौट गई।',
      'गिलहरी कहाँ लौट गई?',
      ['पेड़ पर', 'घर में', 'मैदान में'],
    ],
    [
      'राधा और उसका भाई हर शाम बकरियाँ चराने जाते हैं। रास्ते में एक छोटा पुल पड़ता है। एक दिन बारिश से पुल पर पानी भर गया। दोनों रुक गए और पानी कम होने तक इंतजार किया। घर पहुँचकर उन्होंने पापा को सब बताया।',
      'पुल पर पानी क्यों भर गया?',
      ['बारिश से', 'नल से', 'कुएँ से'],
    ],
    [
      'मोहन को साइकिल चलाना सीखना था। पहले दिन वह दो बार गिरा। उसकी बड़ी बहन ने साइकिल को पीछे से पकड़ा। धीरे धीरे मोहन संभलना सीख गया। एक हफ्ते बाद वह अकेले साइकिल से स्कूल जाने लगा।',
      'मोहन की मदद किसने की?',
      ['बड़ी बहन ने', 'दादाजी ने', 'दोस्त ने'],
    ],
    [
      'हमारे गाँव में हर साल फूलों की प्रदर्शनी लगती है। लोग गेंदे, गुलाब और कमल के फूल लाते हैं। इस बार मेरी दादी के गेंदे के फूल सबसे सुंदर थे। उन्हें एक इनाम मिला। हम सबने मिलकर खुशी मनाई।',
      'दादी को इनाम क्यों मिला?',
      ['उनके फूल सबसे सुंदर थे', 'उन्होंने गाना गाया', 'उन्होंने दौड़ जीती'],
    ],
  ],
  3: [
    [
      'पूजा के स्कूल में एक पुस्तकालय खुला। वहाँ कहानियों, कविताओं और जानवरों की किताबें थीं। पहले हफ्ते पूजा ने समुद्र के बारे में एक किताब ली। उसने पढ़ा कि नीली व्हेल समुद्र का सबसे बड़ा जीव है। शाम को उसने यह बात अपने छोटे भाई को बताई। अब दोनों भाई बहन हर शनिवार एक नई किताब लाते हैं।',
      'पूजा ने पहली किताब किस बारे में ली?',
      ['समुद्र', 'पहाड़', 'जंगल'],
    ],
    [
      'गाँव के तालाब में बहुत कूड़ा जमा हो गया था। मछलियाँ मरने लगीं और पानी से बदबू आने लगी। स्कूल के बच्चों ने एक रविवार तालाब साफ करने का फैसला किया। उनके माता पिता भी साथ आए। सबने मिलकर प्लास्टिक की थैलियाँ और बोतलें निकालीं। कुछ हफ्तों में पानी साफ हो गया और तालाब में फिर से बत्तखें तैरने लगीं।',
      'तालाब साफ करने कौन आए?',
      ['बच्चे और उनके माता पिता', 'सिर्फ शिक्षक', 'शहर के लोग'],
    ],
    [
      'करण को चित्र बनाना बहुत पसंद है। वह जो भी देखता है, उसका चित्र बना लेता है। एक दिन स्कूल में चित्रकला की प्रतियोगिता हुई। विषय था मेरा गाँव। करण ने खेत, कुआँ, बैलगाड़ी और अपने घर का चित्र बनाया। उसने चित्र में चमकीले रंग भरे। करण को दूसरा स्थान मिला और उसके दोस्तों ने तालियाँ बजाईं।',
      'प्रतियोगिता का विषय क्या था?',
      ['मेरा गाँव', 'मेरा स्कूल', 'मेरा परिवार'],
    ],
    [
      'एक बूढ़ी अम्मा गाँव के बाहर अकेली रहती थीं। उनकी आँखें कमजोर हो गई थीं। गाँव की लड़की शबनम रोज स्कूल से लौटते समय उनके घर जाती थी। वह उन्हें अखबार पढ़कर सुनाती और उनके लिए पानी भर देती थी। अम्मा शबनम को पुराने जमाने की कहानियाँ सुनाती थीं। दोनों की दोस्ती पूरे गाँव में मशहूर हो गई।',
      'शबनम अम्मा को क्या पढ़कर सुनाती थी?',
      ['अखबार', 'चिट्ठी', 'कविता'],
    ],
    [
      'शनिवार को रीना अपने पिताजी के साथ हाट गई। हाट में रंग बिरंगी चूड़ियाँ, मिट्टी के बर्तन और ताजी सब्जियाँ बिक रही थीं। पिताजी ने रीना को बीस रुपये दिए और कहा कि अपनी पसंद की चीज खरीदो। रीना ने बहुत सोचा और अपने लिए रंगों का एक डिब्बा खरीदा। घर आकर उसने उन रंगों से अपनी माँ का सुंदर चित्र बनाया।',
      'रीना ने हाट से क्या खरीदा?',
      ['रंगों का डिब्बा', 'चूड़ियाँ', 'मिट्टी का बर्तन'],
    ],
    [
      'हमारी कक्षा एक दिन खेत देखने गई। किसान चाचा ने हमें बताया कि बीज बोने से पहले खेत को जोतना पड़ता है। उन्होंने दिखाया कि पौधों को कितना पानी चाहिए और खाद कैसे डालते हैं। हमने वहाँ गन्ने का रस भी पिया। लौटकर हमने अपनी कॉपी में लिखा कि किसान हमारे लिए कितनी मेहनत करते हैं।',
      'बीज बोने से पहले क्या करना पड़ता है?',
      ['खेत जोतना', 'फसल काटना', 'रस निकालना'],
    ],
  ],
};

const ENGLISH_STORIES: Record<Grade, readonly StorySource[]> = {
  1: [
    [
      'Anu has a green toy frog. The frog can jump. Anu puts it on the bed. Jump, frog, jump!',
      'What colour is the toy frog?',
      ['Green', 'Red', 'Blue'],
    ],
    [
      'Dad and I go to the farm. We see a cow and a hen. The hen has six chicks. They are small and yellow.',
      'How many chicks does the hen have?',
      ['Six', 'Two', 'Ten'],
    ],
    [
      'It is time for lunch. Mom gives me rice and dal. I wash my hands first. Then I eat my food.',
      'What does the child do first?',
      ['Washes hands', 'Eats rice', 'Goes to sleep'],
    ],
    [
      'Ravi has a small drum. He beats the drum. Dum, dum, dum! His baby sister claps and laughs.',
      'What does Ravi beat?',
      ['A drum', 'A ball', 'A bell'],
    ],
    [
      'A little bird sat at my window. It was brown. It sang a sweet song. Then it flew away to a tree.',
      'Where did the bird fly?',
      ['To a tree', 'To the school', 'To the pond'],
    ],
    [
      'I have a box of crayons. I draw a big sun and a red house. I give my drawing to my grandma.',
      'Who gets the drawing?',
      ['Grandma', 'Teacher', 'Brother'],
    ],
  ],
  2: [
    [
      'Neha and her friends planted a mango seed near the school gate. Every day they gave it water. After many days, a tiny green plant came out of the soil. The children were very excited. Their teacher said it would become a big tree with sweet mangoes.',
      'Where did they plant the seed?',
      ['Near the school gate', 'In a pot at home', 'By the river'],
    ],
    [
      'On Sunday, Arjun helped his father wash their old bicycle. They used a bucket of water, soap and a soft cloth. Arjun cleaned the wheels and his father cleaned the seat. When they finished, the bicycle looked shiny and new.',
      'What did Arjun clean?',
      ['The wheels', 'The seat', 'The bell'],
    ],
    [
      'There was a big puddle on the road after the rain. A little boy wanted to jump in it. His mother said, "Wait, let us find your boots." He put on his blue boots and jumped in. Splash! He laughed, and his mother laughed too.',
      'What colour were the boots?',
      ['Blue', 'Black', 'Red'],
    ],
    [
      "Meena's grandfather has a small shop in the market. He sells pencils, notebooks and erasers. After school, Meena sits with him in the shop. She helps him count the notebooks. Grandfather says she is his best helper.",
      'What does Meena count?',
      ['Notebooks', 'Pencils', 'Coins'],
    ],
    [
      'Our class has a fish tank. There are four orange fish and two black fish in it. Each week, one child feeds the fish. This week it is my turn. I give them a little food in the morning, but not too much.',
      'How many black fish are there?',
      ['Two', 'Four', 'Six'],
    ],
    [
      'Sara could not find her pencil. She looked in her bag and under her desk. Then her friend Tom found it on the floor near the door. Sara said, "Thank you, Tom!" and gave him a big smile.',
      'Who found the pencil?',
      ['Tom', 'Sara', 'The teacher'],
    ],
  ],
  3: [
    [
      'Every summer, Priya visits her aunt who lives near the sea. In the morning they walk on the beach and collect shells of many shapes. Priya keeps the shells in a glass jar. One day she found a shell that looked like a tiny fan. Her aunt told her that shells were once the homes of small sea animals.',
      'What does Priya keep in the jar?',
      ['Shells', 'Sand', 'Fish'],
    ],
    [
      'Aman wanted to grow tomatoes. His mother gave him an old pot and some soil. He planted three seeds and kept the pot in the sun. He watered it every evening. After two weeks, small leaves came out. In a few months, the plant had red tomatoes, and Aman shared them with his neighbours.',
      'Where did Aman keep the pot?',
      ['In the sun', 'Under the bed', 'In the kitchen'],
    ],
    [
      'The children of Class 3 made a plan to keep their school clean. They made two dustbins out of old boxes. One was for dry waste like paper, and the other was for wet waste like fruit peels. They painted signs on both boxes. Soon everyone in the school started using them, and the headmaster thanked the class.',
      'What went in the dry waste bin?',
      ['Paper', 'Fruit peels', 'Water'],
    ],
    [
      'Rahul loves to play cricket with his friends after school. One day the ball went over a wall into a garden. The garden belonged to an old lady. Rahul was scared, but he knocked on her gate and said sorry. The old lady smiled and gave the ball back. She also gave the boys some guavas from her tree.',
      'What did the old lady give the boys?',
      ['Guavas', 'Sweets', 'A new ball'],
    ],
    [
      'Last week our village had a health camp. Doctors came from the town and checked everyone for free. They measured our height and weight and checked our eyes. A doctor told us to wash our hands with soap before eating. My grandmother got new glasses at the camp, and now she can read again.',
      'What did grandmother get at the camp?',
      ['New glasses', 'New shoes', 'A new book'],
    ],
    [
      'Zoya found a lost puppy near the bus stop. It was wet and hungry. She wrapped it in her scarf and took it home. Her brother gave it some milk. They made a poster with a picture of the puppy and put it up in the market. The next day a girl came to their house, very happy to see her puppy again.',
      'Where did Zoya find the puppy?',
      ['Near the bus stop', 'In the school', 'At the market'],
    ],
  ],
};

/** Words to read aloud: short and regular for Classes 1 and 2, longer for Class 3. */
const PRACTICE_WORDS: Record<ReadingLanguage, { simple: string[]; harder: string[] }> = {
  hi: {
    simple: [
      'नमक',
      'गमला',
      'सरल',
      'चमक',
      'मकान',
      'अनार',
      'बरतन',
      'कमरा',
      'शहर',
      'वन',
      'रस',
      'मन',
      'थाली',
      'चाय',
      'केला',
      'टमाटर',
      'ताला',
      'आलू',
      'भालू',
      'पैर',
      'तारा',
      'गाना',
      'दाना',
      'मेला',
      'लोटा',
      'जूता',
      'नाव',
      'सावन',
      'झरना',
      'पीला',
    ],
    harder: [
      'बिजली',
      'खरगोश',
      'तरबूज',
      'हिरण',
      'गिलहरी',
      'जहाज',
      'कबूतर',
      'मिठाई',
      'अखबार',
      'पुस्तक',
      'बरसात',
      'सब्जी',
      'चम्मच',
      'दरवाजा',
      'पत्थर',
      'रस्सी',
      'क्यारी',
      'प्रणाम',
      'स्वच्छ',
      'क्षमा',
      'ज्ञान',
      'त्रिकोण',
      'द्वार',
      'विद्यालय',
      'परिवार',
      'मोमबत्ती',
      'इंद्रधनुष',
      'प्रार्थना',
      'स्वतंत्र',
      'कहानी',
    ],
  },
  en: {
    simple: [
      'mat',
      'cap',
      'pot',
      'web',
      'tub',
      'kid',
      'jet',
      'log',
      'bat',
      'wig',
      'nut',
      'yak',
      'hug',
      'den',
      'lid',
      'fin',
      'gum',
      'ram',
      'sad',
      'pin',
      'dig',
      'fog',
      'hop',
      'kit',
      'mop',
      'pan',
      'rug',
      'ten',
      'vet',
      'win',
    ],
    harder: [
      'drum',
      'duck',
      'kite',
      'nose',
      'nest',
      'sock',
      'lamp',
      'door',
      'gate',
      'stamp',
      'grass',
      'chalk',
      'spoon',
      'brush',
      'truck',
      'queen',
      'glass',
      'sheep',
      'mango',
      'table',
      'tiger',
      'lemon',
      'ladder',
      'kitten',
      'mother',
      'window',
      'sister',
      'basket',
      'button',
      'orange',
    ],
  },
};

/** The alphabet in the order it is taught: vowels, then consonants. */
export const PRACTICE_LETTERS: Record<ReadingLanguage, string[]> = {
  hi: [
    'अ',
    'आ',
    'इ',
    'ई',
    'उ',
    'ऊ',
    'ऋ',
    'ए',
    'ऐ',
    'ओ',
    'औ',
    'क',
    'ख',
    'ग',
    'घ',
    'ङ',
    'च',
    'छ',
    'ज',
    'झ',
    'ञ',
    'ट',
    'ठ',
    'ड',
    'ढ',
    'ण',
    'त',
    'थ',
    'द',
    'ध',
    'न',
    'प',
    'फ',
    'ब',
    'भ',
    'म',
    'य',
    'र',
    'ल',
    'व',
    'श',
    'ष',
    'स',
    'ह',
  ],
  en: 'abcdefghijklmnopqrstuvwxyz'.split(''),
};

const number = (index: number) => String(index + 1).padStart(2, '0');

/** The stories for a class and language, in a fixed order. */
export function practiceStories(language: ReadingLanguage, grade: Grade): PracticeStory[] {
  const stories = (language === 'hi' ? HINDI_STORIES : ENGLISH_STORIES)[grade];
  return stories.map(([text, question, choices], index) => ({
    code: `${language}-g${String(grade)}-r${number(index)}`,
    text,
    question,
    choices,
  }));
}

/** The words for a class and language: the simple ones in Classes 1 and 2, the harder in 3. */
export function practiceWords(language: ReadingLanguage, grade: Grade): string[] {
  return [...PRACTICE_WORDS[language][grade === 3 ? 'harder' : 'simple']];
}

/** Every word to read, of both lists, for checks of the content. */
export function allPracticeWords(language: ReadingLanguage): string[] {
  return [...PRACTICE_WORDS[language].simple, ...PRACTICE_WORDS[language].harder];
}

/** Grades 1 to 3 practise their own class's level; older children practise Class 3. */
export function practiceGrade(grade: number | null | undefined): Grade {
  if (grade === 1 || grade === 2) {
    return grade;
  }
  return 3;
}
