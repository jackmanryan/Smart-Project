function resolveFirstName_(name, email) {
  let s = String(name || '').trim();

  // Handle "Last, First ..." format
  if (s.includes(',')) {
    const parts = s.split(',');
    s = (parts[1] || parts[0] || '').trim();
  }
  if (!s) {
    // fallback: infer from email local-part
    const em = String(email || '').trim();
    if (isValidEmail_(em)) {
      const local = em.split('@')[0];
      const parts = local
        .toLowerCase()
        .replace(/\d+/g, ' ')
        .split(/[._-]+/g)
        .filter(Boolean);
      const banned = new Set(['info','sales','contact','support','orders','service','hello','hi','admin']);
      const cand = parts.find(p => !banned.has(p)) || parts[0] || '';
      s = cand;
    }
  }
  // First token only (preserve hyphen/apostrophe segments)
  const firstToken = String(s).trim().split(/\s+/)[0] || '';
  return titleCaseNamePart_(firstToken);
}

function titleCaseNamePart_(token) {
  if (!token) return '';
  return token
    .split(/([-'’])/g) // keep separators
    .map(seg => (seg === '-' || seg === '\'' || seg === '’') ? seg :
      (seg ? seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase() : ''))
    .join('');
}

function getLocalHourAndDow_(tz) {
  const now = new Date();
  const hour = Number(Utilities.formatDate(now, tz, 'H'));
  const dowStr = Utilities.formatDate(now, tz, 'EEE'); // Mon, Tue, ...
  const map = {Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Sun:7};
  const dowNum = map[dowStr] || 1;
  return { hour, dowNum };
}

function buildCSGreetingLine_(hour, dowNum) {
  const monAM = [
    "Happy Monday",
    "Hope your week is off to a great start",
    "Hope your Monday’s going well so far",
    "Hope you had a restful weekend and are ready for a great week ahead",
    "Wishing you a productive start to the week"
  ];
  const tueAM = [
    "Happy Tuesday",
    "Hope you’re having a good week so far",
    "On track for another productive week",
    "Moving forward into the week"
  ];
  const wedAM = [
    "Happy Wednesday",
    "Halfway through the week already",
    "We’re over the hump",
    "Happy hump day"
  ];
  const thuAM = [
    "Hope you're enjoying the weather",
    "Happy Thursday",
    "Nearing the end of the week",
    "It's Friday Eve",
    "Hope your week is going well as we approach the weekend",
    "Final push before the weekend"
  ];
  const friAM = [
    "Happy Friday",
    "Hope you've had a great week",
    "Wrapping up the week",
    "Here’s to a strong end to the week",
    "Here’s to a strong end of the week",
    "Let’s close out the week on a high note",
    "Wishing you a restful and well-deserved weekend ahead"
  ];
  const lateDayMonThu = [
    "I wanted to connect before the day wraps up",
    "I'm reaching out as the day winds down",
    "I'm touching base before everyone heads out for the evening",
    "I'm checking in as we approach the end of the workday",
    "I just wanted to send a quick note before the day comes to a close",
    "I'm following up as the day winds down",
    "I'm connecting before the office checks out for the evening",
    "I wanted to reach out before the day concludes",
    "I wanted to check in as we near the end of the workday",
    "I'm just reaching out before signing off for the day",
    "I just wanted to check in as the day winds down",
    "I hope your day’s been going well as we wrap things up",
    "I thought I’d reach out before the workday comes to a close",
    "I wanted to say hello before everyone calls it a day",
    "I'm checking in as we ease into the evening",
    "I wanted to send a quick note to see how things are before we all sign off",
    "I'm touching base before the day draws to a close",
    "I'm reaching out as things settle down for the day",
    "I hope your afternoon’s been smooth—just thought I’d check in before the day ends",
    "I'm sending a quick hello as the workday wraps up"
  ];
  const friAfternoon = [
    "I just wanted to touch base before everyone signs off for the week",
    "I'm reaching out as we head into the weekend—hope it’s been a good week",
    "I just wanted to check in before we all call it a week",
    "I hope your Friday’s wrapping up nicely—I thought I’d say hello before the weekend",
    "I'm connecting before everyone heads out for some well-earned rest",
    "I'm sending a quick note before the week officially winds down",
    "I'm touching base as we finish up the week—hope it’s been a good one",
    "I'm just checking in before we all head out for the weekend",
    "I'm wishing you a smooth end to the week—I wanted to connect before signing off",
    "I just wanted to see how things are going before the weekend starts",
    "I'm touching base before the week wraps up",
    "I wanted to connect before everyone signs off for the weekend",
    "I'm reaching out as we close out the week",
    "I'm checking in before we all head out for the weekend",
    "I'm just sending a quick note before the week comes to an end",
    "I'm following up before we call it a week",
    "I'm connecting before everyone settles in for the weekend",
    "I wanted to reach out before the week concludes",
    "I wanted to check in as we finish up the workweek",
    "I'm just reaching out before wrapping up for the weekend",
    "I'm checking in before we sign off for Friday",
    "I wanted to connect before the weekend officially starts",
    "I'm sending a quick note before we close out the week",
    "I'm touching base as we head into the weekend",
    "I'm reaching out before shutting down for the week",
    "I'm just checking in before everyone starts their weekend",
    "I'm following up before the week winds down",
    "I'm connecting before the office winds down for the weekend",
    "I wanted to say hello before the week comes to a close",
    "I wanted to check in as we approach the end of the week"
  ];
  const general = [
    "I hope you’re having a fantastic day so far",
    "I hope your day is off to a great start",
    "I hope all is well with you today",
    "I hope you’re enjoying a smooth and productive week",
    "I hope everything’s going well on your end",
    "I trust your week is going wonderfully",
    "I hope you’re keeping well",
    "I hope you’re staying busy in all the best ways",
    "I hope this message finds you in good spirits",
    "I hope you’ve had a pleasant and productive day",
    "I hope you’re having a positive and rewarding day",
    "I hope your week is treating you well so far",
    "I hope you’re doing well and enjoying the week",
    "I trust all is going well for you",
    "I'm wishing you a bright and cheerful day",
    "I hope you’re enjoying some good weather this week",
    "I trust this email finds you in good health and high spirits",
    "I hope you’ve had a chance to enjoy your day",
    "I hope things are going well for you",
    "I hope you’re having a wonderful day",
    "I hope your day is going well so far",
    "I hope you’re staying well and keeping busy",
    "I hope everything is running smoothly on your end",
    "I hope your day has been going well",
    "I hope this finds you well and in good spirits",
    "I hope your day is shaping up nicely",
    "I hope today’s been treating you well",
    "I'm wishing you a positive day ahead"
  ];

  // Logic mirroring your template:
  if (hour <= 10) {
    if (dowNum === 1) return pickRandom_(monAM);
    if (dowNum === 2) return pickRandom_(tueAM);
    if (dowNum === 3) return pickRandom_(wedAM);
    if (dowNum === 4) return pickRandom_(thuAM);
    if (dowNum === 5) return pickRandom_(friAM);
    return pickRandom_(general); // weekend mornings fallback
  } else if (hour >= 15 && dowNum < 5) {
    return pickRandom_(lateDayMonThu);
  } else if (hour >= 13 && dowNum === 5) {
    return pickRandom_(friAfternoon);
  } else {
    return pickRandom_(general);
  }
}