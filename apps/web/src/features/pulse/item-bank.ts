/**
 * The content of Pulse checks. Every check has two parts in one recording:
 *
 * 1. Reading, in the class's language (Hindi or English medium): a passage of a fixed length for the
 *    grade, long enough to measure words correct per minute against the NIPUN Bharat targets
 *    (Class 2: 45 to 60, Class 3: 60 and more). When a child cannot read the passage, the teacher
 *    steps down to familiar words and then to letters, within the same recording.
 * 2. Speaking English: pictures and one question, the same for every class medium. Class 1 names
 *    things, Class 2 says a sentence about a picture, Class 3 talks about a small scene.
 *
 * All content is written for this application and checked by the tests in `item-bank.test.ts`
 * (length, difficulty and spread for each grade). Items have stable codes that are stored with each
 * check, so that a child is never given the same passage or prompt twice and so that scoring knows
 * exactly what was shown.
 */

export type Grade = 1 | 2 | 3;
export type ReadingLanguage = 'hi' | 'en';

const HINDI_PASSAGES: Record<Grade, readonly string[]> = {
  1: [
    'मेरा नाम मीना है। मेरे घर में एक गाय है। गाय का रंग काला है। मैं गाय को घास देती हूँ। गाय हमें दूध देती है।',
    'राजू के पास एक लाल गेंद है। वह गेंद से खेलता है। उसका दोस्त अमन भी आया। दोनों मिलकर मैदान में खेले।',
    'आज बारिश हो रही है। आसमान में काले बादल हैं। रानी ने छाता लिया। वह पानी में कूदी। उसके पैर गीले हो गए।',
    'हमारे बाग में आम का पेड़ है। पेड़ पर हरे आम लगे हैं। एक तोता आम खा रहा है। माली ने तोते को देखा।',
    'सोनू की बिल्ली का नाम पूसी है। पूसी को दूध पसंद है। वह दिन में सोती है। रात को वह चूहे पकड़ती है।',
    'गाँव में मेला लगा है। मेले में बहुत लोग हैं। गीता ने लाल चूड़ी ली। मोहन ने गुब्बारा लिया। सब ने जलेबी खाई।',
    'नदी के पास एक गाँव है। गाँव में छोटे घर हैं। बच्चे नदी में नहाते हैं। माँ नदी पर कपड़े धोती है।',
    'मेरी कक्षा में एक बड़ा बोर्ड है। दीदी बोर्ड पर लिखती हैं। हम सब मिलकर पढ़ते हैं। फिर हम गाना गाते हैं।',
    'सुबह सूरज निकला। मुर्गा बोला। दादी उठ गईं। दादी ने चाय बनाई। मैंने रोटी खाई और स्कूल गया।',
    'कमला के खेत में गेहूँ है। गेहूँ पक गया है। सब लोग फसल काट रहे हैं। कमला सबके लिए पानी लेकर आई।',
    'हमारे घर के पास एक तालाब है। तालाब में मछली और मेंढक हैं। मेंढक टर्र टर्र करता है। मुझे मछली देखना अच्छा लगता है।',
    'पापा बाजार से केले लाए। मैंने एक केला खाया। छोटा भाई भी केला माँग रहा था। मैंने उसे आधा केला दिया।',
  ],
  2: [
    'रविवार को हम चिड़ियाघर गए। वहाँ हमने शेर, भालू और हाथी देखे। हाथी अपनी सूँड से पानी उछाल रहा था। बंदर पेड़ों पर कूद रहे थे। मेरी छोटी बहन बंदरों को देखकर हँसने लगी। शाम को हम थककर घर लौटे।',
    'मीरा की दादी गाँव में रहती हैं। गर्मी की छुट्टियों में मीरा दादी के पास गई। दादी ने उसे कहानियाँ सुनाईं। दोनों ने मिलकर आँगन में फूल लगाए। मीरा रोज सुबह पौधों को पानी देती थी। छुट्टियाँ खत्म होने पर वह उदास हो गई।',
    'हमारे स्कूल में खेल का दिन था। सभी बच्चे सफेद कपड़ों में आए। पहले दौड़ हुई, फिर लंबी कूद हुई। अजय दौड़ में पहले आया। सलमा ने रस्सी कूद में इनाम जीता। अंत में सबको लड्डू बाँटे गए।',
    'एक दिन एक प्यासा कौआ पानी ढूँढ रहा था। उसे एक घड़ा दिखा। घड़े में बहुत थोड़ा पानी था। कौए ने घड़े में छोटे कंकड़ डाले। धीरे धीरे पानी ऊपर आ गया। कौए ने पानी पिया और खुशी से उड़ गया।',
    'बरसात के दिन थे। खेतों में हरियाली छा गई। किसान खुश होकर धान रोप रहे थे। बच्चे तालाब के पास मेंढकों की आवाज सुनकर हँस रहे थे। शाम को आसमान में सुंदर इंद्रधनुष निकला। सबने उसे बड़े ध्यान से देखा।',
    'राहुल को पतंग उड़ाना बहुत अच्छा लगता है। छुट्टी के दिन वह छत पर गया। उसकी पतंग नीले आसमान में ऊँची उड़ी। अचानक हवा तेज हो गई और डोर टूट गई। राहुल दुखी हुआ, पर पापा ने उसे नई पतंग दिला दी।',
    'हमारी गली में एक बूढ़ा कुत्ता रहता है। सब उसे मोती कहते हैं। मोती रात भर गली की रखवाली करता है। बच्चे उसे रोटी खिलाते हैं। जब कोई अनजान आदमी आता है, तो मोती जोर से भौंकने लगता है।',
    'आज माँ ने हलवा बनाया। रसोई में घी और इलायची की खुशबू फैल गई। मैंने कटोरी में हलवा लिया। पहले मैंने दादाजी को दिया। फिर हम सबने आँगन में साथ बैठकर खाया। सबने कहा कि हलवा बहुत स्वादिष्ट बना था।',
    'पिंकी के पास एक छोटा सा पौधा था। वह उसे रोज पानी देती थी और धूप में रखती थी। कुछ दिनों में पौधे पर कलियाँ आ गईं। एक सुबह उन कलियों से लाल फूल खिल गए। पिंकी ने खुश होकर सबको फूल दिखाए।',
    'हमारे गाँव के मेले में एक बड़ा झूला लगा था। टीना और उसका भाई झूले पर बैठे। झूला ऊपर गया तो दोनों डर गए। थोड़ी देर बाद उन्हें मजा आने लगा। उतरकर उन्होंने गोलगप्पे खाए और छोटे खिलौने खरीदे।',
    'नदी किनारे एक पेड़ पर एक बंदर रहता था। नदी के पानी में एक मगरमच्छ रहता था। बंदर रोज मगरमच्छ को मीठे जामुन देता था। धीरे धीरे दोनों अच्छे दोस्त बन गए। वे पेड़ की छाया में घंटों बातें करते थे।',
    'सर्दी का मौसम आ गया है। सुबह बहुत कोहरा रहता है। हम ऊनी कपड़े पहनकर स्कूल जाते हैं। दोपहर में धूप निकलती है तो सब बाहर बैठते हैं। रात को दादी आग जलाती हैं और हमें कहानी सुनाती हैं।',
  ],
  3: [
    'हमारे गाँव के पास एक छोटा जंगल है। वहाँ बहुत तरह के पेड़ और पक्षी हैं। पिछले साल कुछ लोग पेड़ काटने आए। गाँव के बच्चों ने मिलकर उन्हें रोका और समझाया कि पेड़ हमें छाया, फल और साफ हवा देते हैं। अब हर साल बच्चे वहाँ नए पौधे लगाते हैं और उनकी देखभाल करते हैं।',
    'सुमन रोज स्कूल जाने से पहले अपनी माँ की मदद करती है। वह आँगन में झाड़ू लगाती है और बकरियों को चारा डालती है। स्कूल में वह ध्यान से पढ़ती है और अपनी सहेलियों के साथ खेलती भी है। शाम को वह अपने छोटे भाई को अक्षर लिखना सिखाती है। सब कहते हैं कि सुमन बहुत समझदार है।',
    'एक बार एक शेर पेड़ के नीचे गहरी नींद में सो रहा था। एक छोटा चूहा उसके ऊपर दौड़ने लगा। शेर जाग गया और उसने चूहे को पकड़ लिया। चूहे ने कहा कि मुझे छोड़ दो, मैं कभी तुम्हारी मदद करूँगा। कुछ दिन बाद शेर शिकारी के जाल में फँस गया। तब चूहे ने जाल काटकर शेर को आजाद कर दिया।',
    'हमारे विद्यालय में हर शनिवार को बाल सभा होती है। उसमें बच्चे कविता, कहानी और गीत सुनाते हैं। पिछले शनिवार को रवि ने अपने गाँव के तालाब पर एक कविता सुनाई। सबने खूब तालियाँ बजाईं। अध्यापिका ने कहा कि अगली बार हर कक्षा से दो बच्चे बोलेंगे। अब सब बच्चे तैयारी कर रहे हैं।',
    'बरसात में हमारे गाँव की सड़क पर बहुत कीचड़ हो जाता था। बच्चों को स्कूल जाने में परेशानी होती थी। एक दिन गाँव के लोगों ने मिलकर बैठक की। सबने तय किया कि सड़क पर पत्थर और मिट्टी डालकर उसे ऊँचा करेंगे। दस दिनों की मेहनत के बाद सड़क ठीक हो गई और बच्चे खुशी से स्कूल जाने लगे।',
    'दिवाली से पहले हमने पूरे घर की सफाई की। माँ ने दीवारों पर रंग किया और मैंने मिट्टी के दीये रंगे। दिवाली की रात हमने आँगन और छत पर दीये जलाए। चारों ओर रोशनी फैल गई। पड़ोसी हमारे घर मिठाई लेकर आए और हमने भी उन्हें मिठाई दी। हमने पटाखे नहीं चलाए क्योंकि उनसे धुआँ होता है।',
    'राजू के गाँव में कोई अस्पताल नहीं है। जब उसकी दादी बीमार हुईं, तो उन्हें शहर ले जाना पड़ा। रास्ता बहुत लंबा था और सबको बड़ी चिंता हुई। उसी दिन राजू ने तय किया कि वह मन लगाकर पढ़ेगा और डॉक्टर बनेगा। वह चाहता है कि गाँव के लोगों को इलाज के लिए दूर न जाना पड़े।',
    'एक चिड़िया ने पेड़ की ऊँची डाल पर घोंसला बनाया। उसने तिनके, पत्ते और रुई इकट्ठा की। कुछ दिनों बाद घोंसले में तीन छोटे अंडे दिखे। चिड़िया दिन भर अंडों पर बैठी रहती थी। एक सुबह अंडों से नन्हे बच्चे निकले। चिड़िया उनके लिए दाना लाती और अपनी चोंच से उन्हें खिलाती।',
    'हमारी कक्षा में एक नई लड़की आई है। उसका नाम फातिमा है और वह दूसरे शहर से आई है। पहले दिन वह चुपचाप एक कोने में बैठी रही। फिर हमने उसे अपने साथ खेलने बुलाया। अब फातिमा हमारी अच्छी दोस्त है। वह हमें अपने शहर की बातें बताती है और हम उसे अपने गाँव की बातें बताते हैं।',
    'पानी बचाना बहुत जरूरी है। हमारे स्कूल में बच्चों ने एक पानी समिति बनाई है। समिति के बच्चे देखते हैं कि कोई नल खुला न रहे। बरसात का पानी एक बड़े गड्ढे में इकट्ठा किया जाता है। उसी पानी से स्कूल के बगीचे के पौधों को सींचा जाता है। अब हमारा बगीचा पूरे साल हरा भरा रहता है।',
    'एक किसान के पास एक बैल था जिसका नाम हीरा था। हीरा बहुत मेहनती था और रोज खेत जोतता था। एक साल बारिश नहीं हुई और खेत सूख गए। किसान ने हीरा को बेचने का सोचा, पर उसके बेटे ने मना कर दिया। उसने कहा कि हीरा हमारे परिवार का हिस्सा है। अगले साल अच्छी बारिश हुई और खेत फिर लहलहा उठे।',
    'हम सब मिलकर नानी के घर रेलगाड़ी से गए। स्टेशन पर बहुत भीड़ थी। रेलगाड़ी में खिड़की वाली सीट पर बैठकर मैंने खेत, नदियाँ और पहाड़ देखे। रास्ते में एक लड़का चाय और समोसे बेच रहा था। माँ ने सबके लिए गरम समोसे खरीदे। रात होने तक हम नानी के घर पहुँच गए।',
  ],
};

const ENGLISH_PASSAGES: Record<Grade, readonly string[]> = {
  1: [
    'I have a red ball. I play with my ball in the park. My dog runs after the ball. We have fun every day.',
    'Sam has a little cat. The cat is black and white. It likes to drink milk. It sleeps on a soft mat.',
    'It is a sunny day. The sky is blue. Ria and Ben go to the pond. They see ducks and fish in the water.',
    'My mother makes hot rotis. I eat two rotis with dal. My little sister eats one roti. We all eat together.',
    'There is a big tree near my school. Birds sit on the tree. We play under the tree. It gives us cool shade.',
    'Raju has a new bag. It is blue. He puts his books and a pencil in the bag. He takes it to school.',
    'We have a garden at home. There are red and yellow flowers in it. I water the plants every morning with my father.',
    'The bus is big and yellow. It takes us to school. The driver is kind. We sing songs on the bus.',
    'Tina can jump and run. She can ride a bike too. Today she rode her bike to the shop with her friend.',
    'Look at the moon. It is round and bright. The stars are small. I see them from my roof at night.',
    'I have a pet fish. Its name is Goldy. It swims in a glass bowl. I give it food every day.',
    'Mina and her brother fly a kite. The kite is green. It goes up high in the sky. They are very happy.',
  ],
  2: [
    'On Sunday, we went to the zoo. We saw a lion, a bear and a big elephant. The elephant splashed water with its trunk. Monkeys jumped from tree to tree. My little sister laughed at them. In the evening, we came home tired but happy.',
    "Meera went to her grandmother's village in the summer holidays. Grandmother told her many stories. They planted flowers in the yard together. Every morning, Meera watered the plants. When the holidays ended, Meera was sad to leave her grandmother.",
    'It was sports day at our school. All the children came in white clothes. First there was a race, then a long jump. Ajay came first in the race. Salma won a prize in skipping. At the end, everyone got sweets.',
    'A thirsty crow was looking for water. It found a pot with a little water at the bottom. The crow dropped small stones into the pot. Slowly, the water came up. The crow drank the water and flew away happily.',
    'It rained all night. In the morning, the fields were green and the air was fresh. Farmers were busy in their fields. Children played in the puddles and made paper boats. In the evening, a beautiful rainbow came out in the sky.',
    'Rahul loves to fly kites. On a windy day, he went to the roof with his kite. The kite went high into the blue sky. Suddenly the string broke and the kite flew away. Rahul was sad, but his father bought him a new one.',
    'There is an old dog in our street. Everyone calls him Moti. Moti guards our street all night. The children give him rotis and gently pat his head. When a stranger comes, Moti barks loudly to warn us.',
    'Pinky had a small plant in a pot. She watered it every day and kept it in the sun. After a few days, buds came on the plant. One morning, the buds opened into red flowers. Pinky showed the flowers to everyone.',
    'A monkey lived on a tree near a river. A crocodile lived in the river. Every day the monkey gave sweet fruits to the crocodile. They became good friends. They talked for hours in the shade of the tree.',
    'Winter has come. In the morning, there is a lot of fog. We wear warm clothes to school. In the afternoon, the sun comes out and we sit outside. At night, grandmother lights a fire and tells us stories.',
    'There was a fair in our village. Tina and her brother sat on a big swing. When it went up, they were scared. Then they started to enjoy it. After the ride, they ate snacks and bought small toys.',
    'Today my mother made sweet halwa. The kitchen smelled of ghee and cardamom. I filled a small bowl with halwa. First I gave it to my grandfather. Then we all sat together and ate it. The halwa was very tasty.',
  ],
  3: [
    'There is a small forest near our village. It has many kinds of trees and birds. Last year, some men came to cut the trees. The children of the village stopped them and explained that trees give us shade, fruit and clean air. Now every year, the children plant new trees there and take care of them.',
    'Suman helps her mother every morning before school. She sweeps the yard and gives food to the goats. In school, she listens carefully and also plays with her friends. In the evening, she teaches her little brother to write letters and numbers. Everyone says that Suman is a very kind and clever girl.',
    "Once a lion was sleeping under a tree. A little mouse ran over his back. The lion woke up and caught the mouse. The mouse said, please let me go, one day I will help you. A few days later, the lion was caught in a hunter's net. The mouse cut the net with its teeth and set the lion free.",
    "Every Saturday, our school has a children's meeting. Children say poems, tell stories and sing songs. Last Saturday, Ravi said a poem about the pond in his village. Everyone clapped for him. Our teacher said that next time two children from every class will speak. Now all the children are getting ready.",
    'In the rainy season, the road to our village became very muddy. Children found it hard to walk to school. One day, the people of the village held a meeting. They decided to put stones and soil on the road to make it higher. After ten days of hard work, the road was ready and the children walked to school happily.',
    'Before Diwali, we cleaned the whole house. My mother painted the walls and I painted clay lamps. On the night of Diwali, we lit lamps in the yard and on the roof. There was light all around. Our neighbours brought us sweets and we gave them sweets too. We did not burst crackers because they make smoke.',
    "There is no hospital in Raju's village. When his grandmother fell ill, she had to be taken to the town. The road was long and everyone was worried. That day, Raju decided that he would study hard and become a doctor. He wants the people of his village to get help close to home.",
    'A sparrow made a nest on a high branch of a tree. She collected grass, leaves and cotton for it. After some days, there were three small eggs in the nest. The sparrow sat on the eggs all day. One morning, tiny babies came out of the eggs. The sparrow brought grains and fed them with her beak.',
    'A new girl has joined our class. Her name is Fatima and she has come from another city. On the first day, she sat quietly in a corner. Then we asked her to play with us. Now Fatima is our good friend. She tells us about her city, and we tell her about our village.',
    'Saving water is very important. The children of our school have made a water team. The team checks that no tap is left open. Rainwater is collected in a big pit near the school wall. That water is used for the plants in the school garden. Now our garden stays green all year.',
    'A farmer had an ox named Heera. Heera worked hard and ploughed the field every day. One year, there was no rain and the fields dried up. The farmer thought of selling Heera, but his son said no. He said that Heera was a part of their family. The next year, it rained well and the fields were green again.',
    "We all went to grandmother's house by train. The station was very crowded. I sat at the window and saw fields, rivers and hills. On the way, a boy was selling tea and samosas. My mother bought hot samosas for everyone. By night, we reached grandmother's house and she hugged us all.",
  ],
};

/** Familiar words for stepping down: simpler for Classes 1 and 2, with conjuncts for Class 3. */
const STEP_DOWN_WORDS: Record<ReadingLanguage, { simple: string[]; harder: string[] }> = {
  hi: {
    simple: [
      'घर',
      'कमल',
      'जल',
      'फल',
      'नल',
      'आम',
      'पानी',
      'माला',
      'नाना',
      'राजा',
      'दादी',
      'गाय',
      'बस',
      'हाथ',
      'मोर',
      'दूध',
      'सेब',
      'आग',
      'नाक',
      'कान',
      'मामा',
      'चाचा',
      'बतख',
      'मटर',
      'रोटी',
      'नदी',
      'किताब',
      'बकरी',
      'मछली',
      'कलम',
    ],
    harder: [
      'बादल',
      'पतंग',
      'खिड़की',
      'गुब्बारा',
      'बगीचा',
      'चिड़िया',
      'सड़क',
      'कुर्सी',
      'तितली',
      'घड़ी',
      'झूला',
      'पहाड़',
      'सूरज',
      'किसान',
      'दुकान',
      'बाजार',
      'स्कूल',
      'प्यास',
      'स्वाद',
      'पत्ता',
      'बच्चा',
      'कक्षा',
      'मित्र',
      'पत्र',
      'ग्राम',
      'वृक्ष',
      'प्रकाश',
      'त्योहार',
      'सप्ताह',
      'अध्यापक',
    ],
  },
  en: {
    simple: [
      'cat',
      'sun',
      'pen',
      'bag',
      'hat',
      'dog',
      'cup',
      'bed',
      'red',
      'big',
      'run',
      'sit',
      'map',
      'fan',
      'box',
      'leg',
      'pig',
      'hot',
      'bus',
      'top',
      'net',
      'jam',
      'mud',
      'zip',
      'egg',
      'ant',
      'fox',
      'van',
      'hen',
      'rat',
    ],
    harder: [
      'tree',
      'fish',
      'milk',
      'frog',
      'ship',
      'rain',
      'book',
      'star',
      'cake',
      'bird',
      'hand',
      'shop',
      'green',
      'play',
      'jump',
      'sleep',
      'train',
      'clock',
      'plant',
      'smile',
      'chair',
      'snake',
      'bread',
      'light',
      'house',
      'river',
      'teacher',
      'school',
      'water',
      'friend',
    ],
  },
};

const STEP_DOWN_LETTERS: Record<ReadingLanguage, string[]> = {
  hi: [
    'अ',
    'आ',
    'इ',
    'ई',
    'उ',
    'ऊ',
    'ए',
    'ऐ',
    'ओ',
    'औ',
    'क',
    'ख',
    'ग',
    'घ',
    'च',
    'छ',
    'ज',
    'झ',
    'ट',
    'ठ',
    'ड',
    'ढ',
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
    'स',
    'ह',
  ],
  en: [
    'a',
    'm',
    's',
    't',
    'p',
    'n',
    'c',
    'o',
    'g',
    'd',
    'e',
    'b',
    'r',
    'h',
    'i',
    'l',
    'f',
    'u',
    'k',
    'w',
    'j',
    'v',
    'y',
    'z',
    'q',
    'x',
  ],
};

const WORDS_PER_ITEM = 10;
const LETTERS_PER_ITEM = 12;

/** Pictures the speaking prompts use; each is drawn by the application. */
export const PICTURES = [
  'apple',
  'backpack',
  'banana',
  'bed',
  'bird',
  'book',
  'bus',
  'cake',
  'car',
  'carrot',
  'cat',
  'clock',
  'cloud',
  'dog',
  'droplet',
  'egg',
  'fish',
  'flower',
  'gift',
  'grape',
  'house',
  'ice-cream',
  'leaf',
  'milk',
  'moon',
  'mountain',
  'paw',
  'pencil',
  'plane',
  'rabbit',
  'school',
  'shell',
  'ship',
  'squirrel',
  'star',
  'sun',
  'tent',
  'tree',
  'umbrella',
] as const;

export type Picture = (typeof PICTURES)[number];

interface PromptSource {
  pictures: Picture[];
  /** Words a child who answers well is likely to use; for scoring, never shown. */
  keywords: string[];
}

/** Class 1 names two things; Class 2 says a sentence about one; Class 3 talks about a scene. */
const SPEAKING_PROMPTS: Record<Grade, readonly PromptSource[]> = {
  1: [
    { pictures: ['cat', 'sun'], keywords: ['cat', 'sun'] },
    { pictures: ['dog', 'apple'], keywords: ['dog', 'apple'] },
    { pictures: ['fish', 'book'], keywords: ['fish', 'book'] },
    { pictures: ['bird', 'tree'], keywords: ['bird', 'tree'] },
    { pictures: ['bus', 'house'], keywords: ['bus', 'house'] },
    { pictures: ['egg', 'cake'], keywords: ['egg', 'cake'] },
    { pictures: ['moon', 'star'], keywords: ['moon', 'star'] },
    { pictures: ['car', 'flower'], keywords: ['car', 'flower'] },
    { pictures: ['milk', 'banana'], keywords: ['milk', 'banana'] },
    { pictures: ['umbrella', 'clock'], keywords: ['umbrella', 'clock'] },
    { pictures: ['ship', 'plane'], keywords: ['ship', 'boat', 'plane', 'aeroplane'] },
    { pictures: ['rabbit', 'carrot'], keywords: ['rabbit', 'carrot'] },
  ],
  2: [
    { pictures: ['sun'], keywords: ['sun', 'hot', 'sky', 'yellow', 'bright'] },
    { pictures: ['dog'], keywords: ['dog', 'bark', 'pet', 'run'] },
    { pictures: ['apple'], keywords: ['apple', 'red', 'eat', 'fruit', 'sweet'] },
    { pictures: ['bus'], keywords: ['bus', 'school', 'big', 'go', 'ride'] },
    { pictures: ['tree'], keywords: ['tree', 'green', 'big', 'leaves', 'shade'] },
    { pictures: ['fish'], keywords: ['fish', 'water', 'swim', 'river'] },
    { pictures: ['house'], keywords: ['house', 'home', 'live', 'big', 'small'] },
    { pictures: ['book'], keywords: ['book', 'read', 'school', 'story'] },
    { pictures: ['flower'], keywords: ['flower', 'red', 'garden', 'smell', 'pretty'] },
    { pictures: ['rabbit'], keywords: ['rabbit', 'white', 'jump', 'carrot', 'ears'] },
    { pictures: ['ice-cream'], keywords: ['ice', 'cream', 'cold', 'sweet', 'eat'] },
    { pictures: ['umbrella'], keywords: ['umbrella', 'rain', 'open', 'wet'] },
  ],
  3: [
    {
      pictures: ['sun', 'tree', 'bird'],
      keywords: ['sun', 'tree', 'bird', 'sky', 'fly', 'morning'],
    },
    {
      pictures: ['book', 'pencil', 'backpack'],
      keywords: ['book', 'pencil', 'bag', 'school', 'write', 'read'],
    },
    {
      pictures: ['cake', 'gift', 'star'],
      keywords: ['cake', 'gift', 'birthday', 'party', 'happy'],
    },
    {
      pictures: ['bus', 'school', 'backpack'],
      keywords: ['bus', 'school', 'bag', 'go', 'morning'],
    },
    {
      pictures: ['cloud', 'umbrella', 'droplet'],
      keywords: ['cloud', 'rain', 'umbrella', 'wet', 'water'],
    },
    { pictures: ['cat', 'fish', 'milk'], keywords: ['cat', 'fish', 'milk', 'eat', 'drink'] },
    {
      pictures: ['tent', 'mountain', 'tree'],
      keywords: ['tent', 'mountain', 'hill', 'tree', 'camp', 'trip'],
    },
    {
      pictures: ['apple', 'banana', 'grape'],
      keywords: ['apple', 'banana', 'grapes', 'fruit', 'eat'],
    },
    { pictures: ['moon', 'star', 'bed'], keywords: ['moon', 'star', 'night', 'sleep', 'bed'] },
    {
      pictures: ['ship', 'fish', 'shell'],
      keywords: ['ship', 'boat', 'fish', 'sea', 'water', 'shell'],
    },
    { pictures: ['dog', 'paw', 'house'], keywords: ['dog', 'house', 'home', 'pet', 'play'] },
    {
      pictures: ['flower', 'leaf', 'squirrel'],
      keywords: ['flower', 'leaf', 'squirrel', 'garden', 'tree'],
    },
  ],
};

export interface ReadingPart {
  code: string;
  language: ReadingLanguage;
  grade: Grade;
  passage: string;
  words: string[];
  letters: string[];
}

export interface SpeakingPart {
  code: string;
  grade: Grade;
  pictures: Picture[];
  keywords: string[];
  /** What the teacher reads out; stored with the check so that scoring leaves it out. */
  question: string;
}

/** The question for each grade's pictures, read out once by the teacher. */
export const SPEAKING_QUESTIONS: Record<Grade, string> = {
  1: 'What is this?',
  2: 'What is this? Tell me about it.',
  3: 'Look at the pictures. Tell me about them.',
};

/** `count` consecutive entries of `pool`, starting at `start` and wrapping around. */
function slice(pool: readonly string[], start: number, count: number): string[] {
  return Array.from({ length: count }, (_, offset) => pool[(start + offset) % pool.length] ?? '');
}

const number = (index: number) => String(index + 1).padStart(2, '0');

/** Every reading passage for a grade and language, in a fixed order. */
export function readingParts(language: ReadingLanguage, grade: Grade): ReadingPart[] {
  const passages = (language === 'hi' ? HINDI_PASSAGES : ENGLISH_PASSAGES)[grade];
  const words = STEP_DOWN_WORDS[language][grade === 3 ? 'harder' : 'simple'];
  const letters = STEP_DOWN_LETTERS[language];
  return passages.map((passage, index) => ({
    code: `${language}-g${String(grade)}-p${number(index)}`,
    language,
    grade,
    passage,
    words: slice(words, index * 7, WORDS_PER_ITEM),
    letters: slice(letters, index * 5, LETTERS_PER_ITEM),
  }));
}

/** Every English speaking prompt for a grade, in a fixed order. */
export function speakingParts(grade: Grade): SpeakingPart[] {
  return SPEAKING_PROMPTS[grade].map((prompt, index) => ({
    code: `en-g${String(grade)}-s${number(index)}`,
    grade,
    pictures: [...prompt.pictures],
    keywords: [...prompt.keywords],
    question: SPEAKING_QUESTIONS[grade],
  }));
}

/** The words of a passage as a child reads them, without punctuation. */
export function passageWords(passage: string): string[] {
  return passage
    .replace(/[।,.?!;:"]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

export interface PassageMeasures {
  words: number;
  sentences: number;
  /** Conjunct consonants (Devanagari letters joined with a virama). */
  conjuncts: number;
  /** Average letters in a word (English) or code points (Hindi). */
  averageWordLength: number;
}

const VIRAMA = String.fromCharCode(0x094d);

/** What makes a passage harder or easier to read, measured the same way for every passage. */
export function measurePassage(passage: string): PassageMeasures {
  const words = passageWords(passage);
  return {
    words: words.length,
    sentences: passage.split(/[।.?!]/).filter((sentence) => sentence.trim().length > 0).length,
    conjuncts: passage.split(VIRAMA).length - 1,
    averageWordLength:
      words.reduce((total, word) => total + Array.from(word.replace(/'/g, '')).length, 0) /
      Math.max(1, words.length),
  };
}

/** The passage lengths for each grade, chosen against the NIPUN Bharat reading speeds. */
export const PASSAGE_WORDS: Record<Grade, { min: number; max: number }> = {
  1: { min: 18, max: 30 },
  2: { min: 38, max: 55 },
  3: { min: 52, max: 72 },
};

export interface PulseItem {
  reading: ReadingPart;
  speaking: SpeakingPart;
}
