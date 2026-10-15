/**
 * All static content for the InnoTech26 landing page.
 * Source: "INNOTECH26 Budget Note and Proposal" and "Budget and Requirements" documents.
 * Keep copy changes here so components stay presentation-only.
 */
import type { IconName } from "@/components/ui/Icon";

export const event = {
  name: "InnoTech26",
  tagline: "Think Big, Build Smart, Act Sustainable",
  theme: "Building an Innovative, Secure and Sustainable Viksit Bharat @2047",
  finaleDate: "2026-10-30T09:00:00+05:30",
  /** After this the landing page says the event has concluded. */
  finaleEndDate: "2026-10-30T23:59:59+05:30",
  finaleLabel: "30 October 2026",
  venue: "KIET Deemed to be University, Delhi-NCR, Ghaziabad",
  organiser: "Department of Information Technology & CSE (Cyber Security)",
  website: "innotech.kiet.edu",
  /** Where students write with any question or request. */
  email: "innotech@kiet.edu",
  address:
    "KIET Deemed to be University, Delhi-NCR, Meerut Road (NH-58), Ghaziabad, Uttar Pradesh 201206",
  mapUrl: "https://maps.google.com/?q=KIET+Group+of+Institutions+Ghaziabad",
  mapEmbedUrl:
    "https://www.google.com/maps?q=KIET+Group+of+Institutions+Ghaziabad&output=embed",
};

export const navLinks = [
  { label: "About", href: "#about" },
  { label: "Categories", href: "#categories" },
  { label: "Timeline", href: "#timeline" },
  { label: "Prizes", href: "#prizes" },
  { label: "Rules", href: "#rules" },
  { label: "FAQ", href: "#faq" },
  { label: "Contact", href: "#contact" },
];

/**
 * The registration dates VISITORS SEE. Edit these by hand if registration is moved or extended.
 * They are deliberately independent of the server's registration window: the backend can open or
 * close registration whenever operations need (that is what gates the register button and the API),
 * while every date shown on the site, in the hero, timeline, ticker and notices, comes from here.
 */
export const registrationDisplay = {
  opens: "2026-10-03T00:00:00+05:30",
  closes: "2026-10-15T23:59:59+05:30",
};

export const liveUpdates = [
  "Registrations are open until 15 October 2026",
  "No registration fee for any participant",
  "Grand Finale on 30 October 2026 at KIET",
];

export const stats = [
  { value: 8, label: "Categories" },
  { value: 17, label: "Departments" },
  { value: 500000, label: "Prize pool", prefix: "₹", suffix: "+", format: "lakh" as const },
  { value: 16, label: "External judges" },
  { value: 180, label: "Exhibition stalls" },
];

export const about = {
  title: "A platform for ideas that serve society",
  paragraphs: [
    "InnoTech26 is the institute level technical event of KIET, organised by the Department of Information Technology & CSE (Cyber Security). It brings together Artificial Intelligence, Cyber Security, Start-ups and Innovative Projects on one stage.",
    "The event focuses on societal issues and challenges, and on solutions that map to the Sustainable Development Goals (SDGs) and the vision of Viksit Bharat @2047. Students present working projects, prototypes and posters to faculty and external industry judges.",
  ],
};

/** The "at a glance" cards under the About text, so the event is understood without reading the paragraphs. */
export const aboutHighlights: { icon: IconName; title: string; text: string; tone: Tone }[] = [
  { icon: "cpu", title: "Eight categories", text: "AI, software, hardware, start-ups, Gen Z ideas, posters and CyberShield.", tone: "charcoal" },
  { icon: "sprout", title: "Built for society", text: "Projects map to the SDGs and the vision of Viksit Bharat @2047.", tone: "flame" },
  { icon: "users", title: "Open to everyone", text: "KIET students, other colleges and school students.", tone: "flame" },
  { icon: "award", title: "Judged by experts", text: "Faculty and external industry judges score every project.", tone: "charcoal" },
];

/** Colour families shared by the landing diagrams (see components/landing/tones.ts). */
export type Tone = "flame" | "charcoal" | "gold" | "stone";

/** Participation benefits, in the order they sit around the title card. */
export const benefits: { icon: IconName; title: string; text: string; tone: Tone }[] = [
  { icon: "briefcase", title: "Career & Entrepreneurship", text: "Discuss funding and start-up registration with the KIET Technology Business Incubator.", tone: "flame" },
  { icon: "flag", title: "InnoTech Motto", text: "Think Big, Build Smart, Act Sustainable, for a Viksit Bharat @2047.", tone: "charcoal" },
  { icon: "lightbulb", title: "Problem-Solving", text: "Turn ideas into working solutions for real problems faced by society and industry.", tone: "flame" },
  { icon: "rupee", title: "Prize Pool", text: "Prizes worth ₹5 lakh+, including cash prizes of ₹3.4 lakh+.", tone: "gold" },
  { icon: "share", title: "Networking", text: "Connect with faculty, industry experts, registered start-ups and fellow innovators.", tone: "charcoal" },
  { icon: "star", title: "Recognition", text: "Trophies and certificates for winners, and e-certificates for every participant.", tone: "flame" },
  { icon: "users", title: "Confidence", text: "Build confidence, leadership and teamwork by presenting your work.", tone: "stone" },
];

/** Focus domains shown on the landing diagram, in the order they sit around the centre card. */
export const focusDomains: { icon: IconName; title: string; text: string; tone: Tone }[] = [
  { icon: "cpu", title: "Artificial Intelligence & Machine Learning", text: "Build intelligent solutions that learn, adapt and solve real-world problems.", tone: "flame" },
  { icon: "bot", title: "Agentic AI & Generative AI", text: "Create with generative models and autonomous AI agents.", tone: "charcoal" },
  { icon: "shieldOutline", title: "Cyber Security, Privacy & Trustworthy AI", text: "Design secure, resilient systems for a safer digital world.", tone: "gold" },
  { icon: "boxes", title: "Blockchain & Digital Transformation", text: "Build transparent, decentralised and next-gen digital systems.", tone: "stone" },
  { icon: "heart", title: "Healthcare, Biomedical Devices & Biotechnology", text: "Leverage technology for better, accessible and affordable healthcare.", tone: "flame" },
  { icon: "cog", title: "IoT, Robotics & Automation", text: "Connect, automate and build the physical-digital world.", tone: "charcoal" },
  { icon: "city", title: "Smart Cities, Infrastructure & Green Mobility", text: "Build smarter, more liveable and sustainable communities.", tone: "flame" },
  { icon: "glasses", title: "AR/VR, Digital Twins & Industry 4.0", text: "Create immersive experiences and next-gen industrial solutions.", tone: "gold" },
  { icon: "cloud", title: "Big Data, Cloud, 5G/6G & Quantum Technologies", text: "Work with large-scale data, cloud infrastructure and emerging quantum tech.", tone: "charcoal" },
  { icon: "leaf", title: "Disaster Management & Environmental Solutions", text: "Build resilient solutions for a safer and more sustainable planet.", tone: "stone" },
];

export const domains = [
  "Artificial Intelligence & Machine Learning",
  "Agentic AI & Generative AI",
  "Cyber Security, Privacy & Trustworthy AI",
  "IoT, Robotics & Automation",
  "Blockchain & Digital Transformation",
  "Renewable Energy & Sustainable Engineering",
  "Smart Cities, Infrastructure & Green Mobility",
  "Healthcare, Biomedical Devices & Biotechnology",
  "AR/VR, Digital Twins & Industry 4.0",
  "Big Data, Cloud, 5G/6G & Quantum Technologies",
  "Affordable Technology for Rural Development",
  "Disaster Management & Environmental Solutions",
  "Start-up & Revenue Generation Solutions",
];

export type RubricGroup =
  | "software"
  | "hardware"
  | "startup"
  | "genz"
  | "poster"
  | "cybershield";

export type Category = {
  number: number;
  title: string;
  summary: string;
  topics: string[];
  isPoster: boolean;
  firstYearOnly: boolean;
  rubric: RubricGroup;
};

export const categories: Category[] = [
  {
    number: 1,
    title: "Smart Solutions, Smarter Society",
    summary: "Software projects that make everyday services smarter.",
    topics: [
      "Web Services and Applications",
      "APIs and Utilities",
      "Mobile Applications",
      "E-Support and Chatbots",
      "Bioinformatics and Healthcare Solutions",
    ],
    isPoster: false,
    firstYearOnly: false,
    rubric: "software",
  },
  {
    number: 2,
    title: "AI Solutions for Automation",
    summary: "AI-driven projects that automate decisions and processes.",
    topics: [
      "AI Support and Intelligent Solutions",
      "Agentic AI and Automation",
      "Generative AI and LLM Applications",
      "AI-Based Decision Support Systems",
      "Intelligent Process Automation",
    ],
    isPoster: false,
    firstYearOnly: false,
    rubric: "software",
  },
  {
    number: 3,
    title: "Automation and Robotics",
    summary: "IoT, embedded systems and robotics built for the real world.",
    topics: [
      "IoT-Based Applications",
      "Robotics Solutions",
      "IR and Sensor-Based Applications",
      "Smart Manufacturing and Industrial Automation",
      "Image Processing and Computer Vision",
      "NLP-Based Intelligent Systems",
    ],
    isPoster: false,
    firstYearOnly: false,
    rubric: "hardware",
  },
  {
    number: 4,
    title: "From Concept to Reality",
    summary: "Emerging technology and hardware taken from idea to prototype.",
    topics: [
      "Drone Solutions",
      "Space Technology Solutions",
      "Electric Vehicle (EV) Solutions",
      "Medical Devices",
      "Green Energy and Clean Technology",
    ],
    isPoster: false,
    firstYearOnly: false,
    rubric: "hardware",
  },
  {
    number: 5,
    title: "Start Small, Scale Big, Sustain Always",
    summary: "Start-up ideas and business solutions presented as posters.",
    topics: [
      "Start-up Ideas",
      "Marketing Solutions",
      "Productivity and Production Solutions",
      "Revenue Generation Solutions",
      "Economic Growth and Business Solutions",
      "Registered Firms and MSME Solutions",
    ],
    isPoster: true,
    firstYearOnly: false,
    rubric: "startup",
  },
  {
    number: 6,
    title: "Gen Z to Budding Innovators",
    summary:
      "Prototypes and innovative solutions built entirely by first-year students.",
    topics: [
      "Working prototypes on any theme",
      "Innovative solutions to real problems",
      "All team members must be first-year students",
    ],
    isPoster: false,
    firstYearOnly: true,
    rubric: "genz",
  },
  {
    number: 7,
    title: "Creative Visions for a Sustainable Future",
    summary: "Creative ideas, posters and models for a better society.",
    topics: [
      "Civic Sense and Moral Values",
      "Humanity, Ethics, and Social Responsibility",
      "Infrastructure and Architectural Designs",
      "Smart Classrooms, Homes, Buildings, Cities and EVs",
      "Social and Environmental Solutions",
      "Green Energy and Sustainable Development",
      "Ideas without Software or Hardware Implementation",
    ],
    isPoster: true,
    firstYearOnly: false,
    rubric: "poster",
  },
  {
    number: 8,
    title: "CyberShield",
    summary: "Secure, trustworthy and quantum-safe technology.",
    topics: [
      "Threat and Intrusion Detection, Malware Analysis, Forensics",
      "Privacy-preserving and Explainable AI",
      "Post-quantum Cryptography and QKD",
      "Blockchain, Identity and Authentication",
      "Cybercrime and Fraud Prevention",
      "AI and Quantum-enabled Security",
    ],
    isPoster: false,
    firstYearOnly: false,
    rubric: "cybershield",
  },
];

export const participantTracks = [
  {
    title: "KIET Students",
    audience: "All 17 departments",
    steps: ["Register", "Department round", "Finale"],
    points: [
      "Register with your official @kiet.edu email",
      "Compete at department level from 22 to 24 October",
      "Top teams from each department move to the finale",
    ],
  },
  {
    title: "Other Colleges",
    audience: "Students from any college",
    steps: ["Register", "Finale"],
    points: [
      "Register with any valid email address",
      "Choose any one of the eight categories",
      "Teams go directly to the institute level finale",
    ],
  },
  {
    title: "School Students",
    audience: "Budding Engineers",
    steps: ["Register", "Finale"],
    points: [
      "Choose any one of the eight categories",
      "Teams go directly to the institute level finale",
      "Compete for the Best School Project/Poster award",
    ],
  },
];

export type Milestone = {
  title: string;
  dateLabel: string;
  start: string;
  end: string;
  description: string;
};

export const timeline: Milestone[] = [
  {
    title: "Registrations Open",
    dateLabel: "3 Oct 2026",
    start: "2026-10-03",
    end: "2026-10-03",
    description: "Individual registration begins. Team leaders can start forming teams.",
  },
  {
    title: "Registrations Close",
    dateLabel: "15 Oct 2026",
    start: "2026-10-15",
    end: "2026-10-15",
    description: "Last day to register and submit your team. Teams are locked after submission.",
  },
  {
    title: "Department Level",
    dateLabel: "22 - 24 Oct 2026",
    start: "2026-10-22",
    end: "2026-10-24",
    description: "KIET teams are evaluated by faculty from other departments using common rubrics.",
  },
  {
    title: "Finalists Declared",
    dateLabel: "26 Oct 2026",
    start: "2026-10-26",
    end: "2026-10-26",
    description: "Department finalists are announced for the institute level finale.",
  },
  {
    title: "Grand Finale",
    dateLabel: "30 Oct 2026",
    start: "2026-10-30",
    end: "2026-10-30",
    description: "Institute level exhibition, external jury evaluation and prize distribution.",
  },
];

/** Amounts are per category; `awards` is how many categories (or awards) each row applies to. */
export const institutePrizes = [
  {
    title: "Project Categories",
    categories: "Categories 1, 2, 3, 4, 6 and 8",
    awards: 6,
    first: 8000,
    second: 5000,
  },
  {
    title: "Poster Categories",
    categories: "Categories 5 and 7",
    awards: 2,
    first: 4000,
    second: 3000,
  },
  {
    title: "Best School Project",
    categories: "School project or poster",
    awards: 1,
    first: 5000,
    second: 3000,
  },
];

/** 1st position in every category, awarded separately in each department. */
export const departmentPrizes = [
  { categories: "Categories 1, 2, 3, 4, 6 and 8", awards: 6, first: 2000 },
  { categories: "Categories 5 and 7", awards: 2, first: 1000 },
];

/** Headline prize figures. The pool includes trophies, certificates and awards beyond the cash prizes. */
export const prizeHeadline = { pool: "₹5 lakh+", cash: "₹3.4 lakh+" };

export const departments = [
  "CSE",
  "CS",
  "IT",
  "CSIT",
  "CSE(AI)",
  "CSE(AIML)",
  "CSE(DS)",
  "CSE(CS)",
  "EN",
  "EC",
  "ELCE",
  "ME",
  "VLSI",
  "AMIA",
  "MCA",
  "KSOM",
  "KSOP",
  "COE",
];

/** COE KIET / technical clubs: a department of its own. Its students also give their club's name. */
export const clubDepartment = "COE";

/** The departments the prize pool counts. COE is not one of them (its prizes are not part of the published pool). */
export const prizeDepartments = departments.filter((d) => d !== clubDepartment);

/** What a department is called in dropdowns. The stored value stays the code, e.g. KSOM. */
const departmentLabels: Record<string, string> = { KSOM: "MBA (KSOM)", COE: "COE KIET / Technical Club KIET" };
export const departmentLabel = (department: string) => departmentLabels[department] ?? department;

/** Cash totals per level, from the prize tables above; the department pool counts every department. */
export const prizePools = {
  institute: institutePrizes.reduce((sum, p) => sum + p.awards * (p.first + p.second), 0),
  department: prizeDepartments.length * departmentPrizes.reduce((sum, p) => sum + p.awards * p.first, 0),
};

type Criterion = { title: string; parts?: string[] };

/** Judging rubrics, kept for the judges module. Not shown on the public site. */
export const rubrics: Record<
  RubricGroup,
  { label: string; appliesTo: string; criteria: Criterion[] }
> = {
  software: {
    label: "Software",
    appliesTo: "Categories 1 and 2",
    criteria: [
      { title: "Project Showcasing", parts: ["Team Presentation Skills", "Project Understanding"] },
      { title: "Innovation & Novelty", parts: ["Originality of Project", "Employed Technology & AI Tools"] },
      { title: "Relevance & Application", parts: ["Significance for Society", "Practical Application to the Problem"] },
      { title: "Usability & Scalability", parts: ["Ease of Use", "Potential to Scale"] },
      { title: "Query Addressing" },
    ],
  },
  hardware: {
    label: "Hardware",
    appliesTo: "Categories 3 and 4",
    criteria: [
      { title: "Design & Build Quality", parts: ["Neatness & Safety", "Robustness of Hardware"] },
      { title: "Working Model", parts: ["Originality of Approach", "Novel Hardware Integration"] },
      { title: "Technology & AI Integration", parts: ["Sensors, IoT, Robotics Usage", "AI/Automation Potential"] },
      { title: "Future Scope & Impact", parts: ["Scalability / Commercial Feasibility", "Societal / Environmental Relevance"] },
      { title: "Query Addressing" },
    ],
  },
  startup: {
    label: "Start-up",
    appliesTo: "Category 5",
    criteria: [
      { title: "Uniqueness of Idea", parts: ["Novelty of Concept", "Differentiation from Existing Solutions"] },
      { title: "Market Feasibility", parts: ["Business Model Strength", "Target Audience Fit"] },
      { title: "Revenue & Sustainability", parts: ["Potential to Generate Profit", "Long-Term Sustainability"] },
      { title: "Societal / Economic Relevance", parts: ["Contribution to Society", "Contribution to Economy"] },
      { title: "Query Addressing" },
    ],
  },
  genz: {
    label: "Gen Z",
    appliesTo: "Category 6",
    criteria: [
      { title: "Concept & Originality", parts: ["Originality of Idea", "Understanding of the Problem"] },
      { title: "Working Prototype", parts: ["Functionality of Prototype", "Effort & Build Quality"] },
      { title: "Impact Value", parts: ["Relevance to Society / SDGs", "Potential to Inspire Change"] },
      { title: "Presentation & Teamwork", parts: ["Clarity of Explanation", "Team Coordination"] },
      { title: "Query Addressing" },
    ],
  },
  poster: {
    label: "Poster & Models",
    appliesTo: "Category 7",
    criteria: [
      { title: "Concept Innovation", parts: ["Originality of Idea", "Artistic Appeal & Creativity"] },
      { title: "Impact Value", parts: ["Relevance to Society / SDGs", "Potential to Inspire Change"] },
      { title: "Message Clarity", parts: ["Easy to Understand", "Logical Flow"] },
      { title: "Visual Design", parts: ["Neatness & Balance", "Artistic Appeal"] },
      { title: "Query Addressing" },
    ],
  },
  cybershield: {
    label: "CyberShield",
    appliesTo: "Category 8",
    criteria: [
      { title: "Threat Understanding", parts: ["Clarity of Threat Model", "Real-world Relevance"] },
      { title: "Security Design & Innovation", parts: ["Originality of Approach", "Use of Security Techniques & Tools"] },
      { title: "Implementation & Demo", parts: ["Working Demo", "Robustness Against Attacks"] },
      { title: "Impact & Compliance", parts: ["Societal / Organisational Impact", "Privacy, Ethical & Legal Compliance"] },
      { title: "Query Addressing" },
    ],
  },
};

export const teamRules = [
  "A team has 2 to 5 members.",
  "All members must be from the same college or school.",
  "KIET teams can have members from different courses and branches. The team belongs to the leader's department.",
  "A team can register for only one category.",
  "A student can be part of only one team.",
  "Once a team is submitted, members and category cannot be changed.",
  "If any member withdraws, the team is not considered further.",
  "KIET students must register with their official @kiet.edu email.",
  "There is no registration fee. No reimbursement is given for project materials.",
];

export const registrationSteps = [
  { title: "Create your account", text: "Every student registers individually and completes their profile." },
  { title: "Form a team", text: "The team leader creates a team and picks one category." },
  { title: "Add members", text: "The leader shares an invite link on WhatsApp or anywhere else; teammates open it and join with the team code." },
  { title: "Submit the team", text: "Once 2 to 5 members have joined, the leader submits and the team is locked." },
];

/** Finale-day attractions: the first three sit left of the centre card, the rest on the right. */
export const attractions: { icon: IconName; title: string; text: string; tone: Tone }[] = [
  { icon: "sprout", title: "TBI Support", text: "Funding discussions and start-up registration guidance.", tone: "flame" },
  { icon: "code", title: "Technical Clubs", text: "Live projects from the technical clubs of the institute.", tone: "charcoal" },
  { icon: "rocket", title: "Registered Start-ups", text: "Start-ups from KIET TBI showcase and promote their products.", tone: "gold" },
  { icon: "lightbulb", title: "Centres of Excellence", text: "Projects and ideas from KIET's Centres of Excellence.", tone: "charcoal" },
  { icon: "shield", title: "CyberShield Zone", text: "Live security demos, a cyber-awareness corner and a mini CTF challenge.", tone: "flame" },
  { icon: "users", title: "People's Choice Award", text: "Visitors vote for their favourite project by scanning a QR code.", tone: "gold" },
];

export const gallery = [
  { src: "/images/kiet/campus-walkway.jpg", alt: "Covered walkway through the KIET campus gardens", wide: true },
  { src: "/images/kiet/infra-2.webp", alt: "KIET academic block surrounded by trees" },
  { src: "/images/kiet/ai-skills-lab.jpg", alt: "Students working in the AI Skills Lab", wide: true },
  { src: "/images/kiet/auditorium.webp", alt: "Students attending an event in the KIET auditorium" },
  { src: "/images/kiet/library.jpg", alt: "Students studying in the KIET library" },
  { src: "/images/kiet/infra-3.webp", alt: "Aerial view of the lawns between KIET buildings" },
  { src: "/images/kiet/seminar-hall.webp", alt: "Seminar in progress at the KIET CRPC hall" },
  { src: "/images/kiet/infra-1.jpg", alt: "Palm-lined courtyard on the KIET campus", wide: true },
  { src: "/images/kiet/sports.webp", alt: "Students playing cricket on the KIET ground" },
];

export const faqs = [
  {
    question: "Is there a registration fee?",
    answer: "No. Registration is free for everyone. No reimbursement is given for items used in projects, posters or models.",
  },
  {
    question: "How do I join my friend's team?",
    answer:
      "Open the invite link your leader shares (on WhatsApp or anywhere else), sign in with Google and complete your profile; the team code is filled in for you. You can also type the code on your dashboard. You can be part of only one team.",
  },
  {
    question: "I am a KIET student. Can I sign in with my personal Gmail?",
    answer:
      "No. KIET students must sign in with their official @kiet.edu Google account. A personal Gmail account can only register as a student of another college or a school.",
  },
  {
    question: "Whom do I contact with a question or request?",
    answer:
      "Write to innotech@kiet.edu from the email you registered with. Mention your name and, if you have one, your team code (for example IT26-0042), so the organising team can help you quickly.",
  },
];
