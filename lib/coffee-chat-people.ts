export type PlaceholderPerson = {
  id: string;
  name: string;
  roles: { id: string; role_name: string }[];
  avatarUrl: null;
  interests: string;
};

export const PLACEHOLDER_PEOPLE: PlaceholderPerson[] = [
  { id: "0",  name: "Alex Chen",        roles: [{ id: "r0",  role_name: "President" }],                                         avatarUrl: null, interests: "Machine learning, product design, hiking" },
  { id: "1",  name: "Jordan Lee",       roles: [{ id: "r1",  role_name: "VP Engineering" }],                                    avatarUrl: null, interests: "Distributed systems, rock climbing, specialty coffee" },
  { id: "2",  name: "Maya Patel",       roles: [{ id: "r2",  role_name: "Exec" }],                                              avatarUrl: null, interests: "Biotech, yoga, reading sci-fi" },
  { id: "3",  name: "Ethan Kim",        roles: [{ id: "r3",  role_name: "Board" }],                                             avatarUrl: null, interests: "Venture capital, tennis, philosophy" },
  { id: "4",  name: "Sofia Torres",     roles: [{ id: "r4",  role_name: "Director" }],                                          avatarUrl: null, interests: "UX research, ceramics, film photography" },
  { id: "5",  name: "Liam Zhang",       roles: [{ id: "r5a", role_name: "Exec" }, { id: "r5b", role_name: "Board" }],           avatarUrl: null, interests: "Robotics, cycling, competitive chess" },
  { id: "6",  name: "Ava Nguyen",       roles: [{ id: "r6",  role_name: "VP Marketing" }],                                      avatarUrl: null, interests: "Brand strategy, painting, running" },
  { id: "7",  name: "Noah Park",        roles: [{ id: "r7",  role_name: "Board" }],                                             avatarUrl: null, interests: "Fintech, guitar, travel" },
  { id: "8",  name: "Isabella Moore",   roles: [{ id: "r8",  role_name: "Exec" }],                                              avatarUrl: null, interests: "Sustainability, cooking, SCUBA diving" },
  { id: "9",  name: "James Liu",        roles: [{ id: "r9",  role_name: "Director" }],                                          avatarUrl: null, interests: "Developer tools, bouldering, jazz" },
  { id: "10", name: "Mia Johnson",      roles: [{ id: "r10", role_name: "Board" }],                                             avatarUrl: null, interests: "Health tech, pilates, poetry" },
  { id: "11", name: "Lucas Martinez",   roles: [{ id: "r11", role_name: "VP Operations" }],                                     avatarUrl: null, interests: "Supply chain, woodworking, basketball" },
  { id: "12", name: "Charlotte Brown",  roles: [{ id: "r12", role_name: "Exec" }],                                              avatarUrl: null, interests: "EdTech, watercolor, podcasting" },
  { id: "13", name: "Henry Wilson",     roles: [{ id: "r13", role_name: "Board" }],                                             avatarUrl: null, interests: "Cybersecurity, skiing, board games" },
  { id: "14", name: "Amelia Davis",     roles: [{ id: "r14", role_name: "Director" }],                                          avatarUrl: null, interests: "Social impact, dance, urban farming" },
  { id: "15", name: "Oliver Garcia",    roles: [{ id: "r15", role_name: "Exec" }],                                              avatarUrl: null, interests: "AR/VR, surfing, video production" },
  { id: "16", name: "Harper Taylor",    roles: [{ id: "r16", role_name: "Board" }],                                             avatarUrl: null, interests: "Climate tech, swimming, creative writing" },
  { id: "17", name: "Elijah Anderson",  roles: [{ id: "r17", role_name: "VP Finance" }],                                        avatarUrl: null, interests: "Crypto, golf, mentorship" },
  { id: "18", name: "Abigail Thomas",   roles: [{ id: "r18", role_name: "Exec" }],                                              avatarUrl: null, interests: "Bioengineering, hiking, astronomy" },
  { id: "19", name: "Sebastian Jackson",roles: [{ id: "r19", role_name: "Board" }],                                             avatarUrl: null, interests: "AI policy, sailing, architecture" },
];

const ALL_SLOTS = ["9:00 AM", "10:00 AM", "11:00 AM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"];

export type AvailableDay = {
  date: Date;
  label: string;
  slots: string[];
};

export function getAvailability(personIndex: number): AvailableDay[] {
  const result: AvailableDay[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let dayOffset = 1;
  let weekdaysFound = 0;

  while (weekdaysFound < 10) {
    const date = new Date(today);
    date.setDate(today.getDate() + dayOffset);
    dayOffset++;

    const dow = date.getDay();
    if (dow === 0 || dow === 6) continue;
    weekdaysFound++;

    const availableSlots = ALL_SLOTS.filter((_, slotIndex) => {
      const n = (personIndex * 37 + weekdaysFound * 13 + slotIndex * 7 + 11) % 10;
      return n > 2;
    });

    result.push({
      date,
      label: date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
      slots: availableSlots,
    });
  }

  return result;
}
