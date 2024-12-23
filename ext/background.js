console.log('reload');

const htmlEntities = {amp: '&', lt: '<', gt: '>', quot: '"', '#039': "'"}
const reHtmlEntities = new RegExp(`&(${Object.keys(htmlEntities).join('|')});`, 'g');
function unescapeHtmlEntities(str) {
	return str.replace(reHtmlEntities, (m, c) => htmlEntities[c]);
}

// data.home.home_timeline_urt.responseObjects.feedbackActions -> key, value
// entries .content.feedbackInfo.feedbackKeys (list)
// DontLike -> tweet id
// SeeFewer -> user id
// NotRelevant - ???

let FEEDBACK_TO_TWEET = {};
let SKIP_TWEET_IDS = new Set(localStorage['SKIP_TWEET_IDS'] ? JSON.parse(localStorage['SKIP_TWEET_IDS']) : []);
let SKIP_USER_IDS = new Set(localStorage['SKIP_USER_IDS'] ? JSON.parse(localStorage['SKIP_USER_IDS']) : []);
// TODO: expire

const saveSettings = () => {
  localStorage['SKIP_TWEET_IDS'] = JSON.stringify([...SKIP_TWEET_IDS]);
  localStorage['SKIP_USER_IDS'] = JSON.stringify([...SKIP_USER_IDS]);
  console.log('saved');
};
let _saveSettingsInterval = setInterval(saveSettings, 10000);


function listenerHomeTimeline(details) {
  console.log(`HomeTimeline: ${details.url}`);

  let filter = browser.webRequest.filterResponseData(details.requestId);
  let decoder = new TextDecoder("utf-8");

  const chunks = [];
  filter.ondata = event => { chunks.push(decoder.decode(event.data, {stream: true})); }

  filter.onstop = event => {
    try {
      console.log('decoder', decoder.decode(undefined, {stream: false}));
    } catch {}
  
    const data = JSON.parse(chunks.join(""));

    const feedbackKeyMap = {};
    if (data.data.home.home_timeline_urt.responseObjects) {
      data.data.home.home_timeline_urt.responseObjects.feedbackActions.forEach(i => {
        console.log(i.key+'', i.value);
        if (i.value.feedbackType === "RichBehavior") {
          console.log('RichBehavior', i);
          return;
        }
        feedbackKeyMap[i.key] = {...i.value};
        try {
          feedbackKeyMap[i.key]._q = i.value.feedbackUrl.split('/2/timeline/feedback.json?')[1];
        } catch (e) {
          console.log(i);
          console.error(e);
        }
      });
    }
    console.log(feedbackKeyMap);

    let instr = data.data.home.home_timeline_urt.instructions;
    let TimelineAddEntries = null;
    for (let ins of instr) {
      if (ins.type === 'TimelineAddEntries') {
        TimelineAddEntries = ins;
      }
    }

    if (instr) {
      const newInstr = [];
      for (let i of instr) {
        console.log(i.type);
        if (i.type === 'TimelineShowAlert') {
          console.log('Removing TimelineShowAlert', i);
          continue;
        }
        newInstr.push(i);
      }
      data.data.home.home_timeline_urt.instructions = newInstr;
    }
    instr = data.data.home.home_timeline_urt.instructions;

    if (TimelineAddEntries) {
      const ientrs = TimelineAddEntries.entries;
      const newEntries = [];
      for (let i of ientrs) {
        console.log('---------', i.entryId, i.sortIndex);
        if (
          /^cursor-/.test(i.entryId)
          || /^home-conversation-/.test(i.entryId)) {  // TODO: skipped for now
          newEntries.push(i);
          continue;
        }

        if (
          /^promoted-tweet-/.test(i.entryId)
          || /^who-to-follow-/.test(i.entryId)
          || /^community-to-join-/.test(i.entryId)
          || /^pinned-tweets-/.test(i.entryId)
          || /^messageprompt-premium-/.test(i.entryId)
          || /^messageprompt-/.test(i.entryId)
          || /^who-to-subscribe-/.test(i.entryId)) {
          console.log('skipping');
          continue;
        }

        if (!/^tweet-/.test(i.entryId)) {
          console.log('##### NEW TYPE', i);
          newEntries.push(i);
          continue;
        }

        console.log(i);
        // content.itemContent.tweet_results.result.views.count

        let tweetId, tweetUserId;
        try {
          tweetId = i.content.itemContent.tweet_results.result.legacy.id_str;
          tweetUserId = i.content.itemContent.tweet_results.result.legacy.user_id_str;
        } catch (e) {
          console.log(i);
          console.error(e);
          continue;
        }
        console.log(tweetId, tweetUserId,
          JSON.stringify(tweetId), JSON.stringify(tweetUserId),
          typeof tweetId, typeof tweetUserId, SKIP_TWEET_IDS.has(tweetId), SKIP_USER_IDS.has(tweetUserId),
          SKIP_TWEET_IDS.size);

        if (SKIP_TWEET_IDS.has(tweetId)) {
          console.log('fb tweet skipped');
          continue;
        }
        if (SKIP_USER_IDS.has(tweetUserId)) {
          console.log('fb user skipped');
          continue;
        }

        try {
          console.log(i.content.feedbackInfo);
          i.content.feedbackInfo.feedbackKeys.forEach(fbKey => {
            const fb = feedbackKeyMap[fbKey];
            // console.log('fbKey', fbKey, fb);
            if (fb) {  // types like RichBehavior skipped
              FEEDBACK_TO_TWEET[fb._q] = {type: fb.feedbackType, tweetId, tweetUserId};
              fb.childKeys.forEach(childKey => {  // only 1 level deep?
                const fb = feedbackKeyMap[childKey];
                if (fb) {
                  FEEDBACK_TO_TWEET[fb._q] = {type: fb.feedbackType, tweetId, tweetUserId};
                }
              });
            }
          });
        } catch (e) {
          console.log('feedbackKeys--');
          console.error(e);
        }

        try {
          if (i.content.itemContent.tweet_results.result.core.user_results.result.legacy.following) {
            newEntries.push(i);
            continue;
          }
        } catch(e) { }
        try {
          const viewsNum = parseInt(i.content.itemContent.tweet_results.result.views.count, 10);
          console.log('Views', viewsNum);
          // if (viewsNum > 500000) { continue; }
        } catch(e) { }

        try {
          const aff = i.content.itemContent.tweet_results.result.core.user_results.result.affiliates_highlighted_label.label.url.url;
          console.log('aff', aff);
        } catch (e) {
          // console.log('aff--');
          // console.error(e);
        }

        try {
          const entitiesUrls = i.content.itemContent.tweet_results.result.legacy.entities.urls;
          console.log(entitiesUrls);
          for (let url of entitiesUrls) {
            console.log(url.expanded_url);
          }
        } catch (e) {
          console.log(i);
          console.log(JSON.stringify(i));
          console.error(e);
        }

        newEntries.push(i);
      }
      TimelineAddEntries.entries = newEntries.length ? newEntries : ientrs.slice(-1);
    } else {
      console.log('Instructions are wrong');
      console.log('instr', instr.length, instr.map(i => i.type));
      for (let i of instr) {
        if (i.type === 'TimelineAddEntries') continue;
        console.log(i);
      }
    }

    let encoder = new TextEncoder();
    filter.write(encoder.encode(JSON.stringify(data)));
    filter.close();
  }


  return {};
}
browser.webRequest.onBeforeRequest.addListener(
  listenerHomeTimeline,
  { urls: ["https://x.com/i/api/*/HomeTimeline*"], },
  ["blocking"],
);


function listenerUser(details) {
  console.log(`UserTweets: ${details.url}`);

  let filter = browser.webRequest.filterResponseData(details.requestId);
  let decoder = new TextDecoder("utf-8");
  let encoder = new TextEncoder();

  const chunks = [];
  filter.ondata = event => { chunks.push(decoder.decode(event.data, {stream: true})); }

  filter.onstop = event => {
    try {
      console.log('decoder', decoder.decode(undefined, {stream: false}));
    } catch {}
  
    const data = JSON.parse(chunks.join(""));

    let instr = data.data.user.result.timeline_v2.timeline.instructions;
    let TimelineAddEntries = null;
    for (let ins of instr) {
      if (ins.type === 'TimelineAddEntries') {
        TimelineAddEntries = ins;
      }
    }

    if (TimelineAddEntries) {
      const ientrs = TimelineAddEntries.entries;
      const newEntries = [];
      for (let i of ientrs) {
        console.log(i.entryId, i.sortIndex);
        if (/^cursor-/.test(i.entryId)) {
          newEntries.push(i);
          continue;
        }

        if (
          /^promoted-tweet-/.test(i.entryId)
          || /^who-to-follow-/.test(i.entryId)
          || /^who-to-subscribe-/.test(i.entryId)) {
          console.log('skipping');
          continue;
        }
        newEntries.push(i);
      }
      TimelineAddEntries.entries = newEntries;
    }

    filter.write(encoder.encode(JSON.stringify(data)));
    filter.close();
  }

  return {};
}
browser.webRequest.onBeforeRequest.addListener(
  listenerUser,
  { urls: ["https://x.com/i/api/graphql/*/UserTweets*"], },
  ["blocking"],
);


function listenerFeedback(details) {
  console.log(`Feedback:`, details.url);
  // we need to save mapping of meta to tweet id, action in HomeTimeline

  // https://x.com/i/api/2/timeline/feedback.json?feedback_type=DontLike&action_metadata=base64blabla
  const meta = details.url.split('/2/timeline/feedback.json?')[1];
  console.log(meta, FEEDBACK_TO_TWEET[meta]);

  const fb = FEEDBACK_TO_TWEET[meta];
  if (fb) {
    SKIP_TWEET_IDS.add(fb.tweetId);
    if (fb.type === 'SeeFewer') {
      SKIP_USER_IDS.add(fb.tweetUserId);
    }
  }

  return {};
}
browser.webRequest.onBeforeRequest.addListener(
  listenerFeedback,
  { urls: ["https://x.com/i/api/2/timeline/feedback.json*"], },
  ["blocking"],
);

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== "openNewTab") return;
  browser.tabs.create({
    url: message.url,
    active: false,
    cookieStoreId: sender.tab.cookieStoreId
  });
});

browser.runtime.onMessage.addListener((message, sender) => {
  if (message.action !== "injectScript") return;
  browser.tabs.executeScript(sender.tab.id, {
    file: `real-content.js?v=${Date.now()}`
  });
});

// ---

function find_dicts_deep_paths(data, fnMatch, path = []) {
  const results = [];
  if (typeof data === 'object' && data !== null) {
    if (Array.isArray(data)) {
      data.forEach((item, index) => {
        results.push(...find_dicts_deep_paths(item, fnMatch, [...path, index]));
      });
    } else {
      if (fnMatch(data)) {
        results.push([path, data]);
      } else {
        for (const [key, value] of Object.entries(data)) {
          results.push(...find_dicts_deep_paths(value, fnMatch, [...path, key]));
        }
      }
    }
  }
  return results;
}

function find_dicts_deep(data, fnMatch) {
  return find_dicts_deep_paths(data, fnMatch).map(([_, obj]) => obj);
}

const find_all_tweets = (data) => find_dicts_deep(data, (d) => d.__typename === 'Tweet');

function listenerTweetDetail(details) {
  console.log(`TweetDetail: ${details.url}`);

  let filter = browser.webRequest.filterResponseData(details.requestId);
  let decoder = new TextDecoder("utf-8");
  let encoder = new TextEncoder();

  const chunks = [];
  filter.ondata = event => { chunks.push(decoder.decode(event.data, {stream: true})); }

  filter.onstop = event => {
    try {
      console.log('decoder', decoder.decode(undefined, {stream: false}));
    } catch {}
  
    const data = JSON.parse(chunks.join(""));

    // show tweets from muted accounts in replies
    for (let t of find_dicts_deep(data, (d) => d.__typename === 'TweetWithVisibilityResults')) {
      t.__typename = "Tweet";
      const tweet = t.tweet;
      delete t.tweet;
      delete t.tweetInterstitial;
      Object.assign(t, tweet);
    }

    // show full tweet text without clicking "Show More"
    // TODO: add style [data-testid="tweetText"] { -webkit-line-clamp: unset !important; }
    const allTweets = find_all_tweets(data);
    for (let t of allTweets) {
      if (!t.note_tweet) { continue; }

      const noteTweetText = t.note_tweet.note_tweet_results.result.text;

      const [displayA, displayB] = t.legacy.display_text_range;
      const beforeText = Array.from(t.legacy.full_text).slice(0, displayA).join('');
      let visibleText = unescapeHtmlEntities(
        Array.from(t.legacy.full_text).slice(displayA, displayB).join('')
      );

      if (!noteTweetText.startsWith(visibleText)) {
        console.log('note tweet not starts with visible text');
        console.log(noteTweetText);
        console.log(visibleText);
        continue;
      }
      t.legacy.full_text = beforeText + noteTweetText;
      t.note_tweet.is_expandable = false;
      t.legacy.display_text_range[1] = displayA + noteTweetText.length;

      const entitySet = t.note_tweet.note_tweet_results.result.entity_set;
      for (const entityType in entitySet) {
        for (const entity of entitySet[entityType]) {
          if (entity.indices) {
            entity.indices[0] += displayA;
            entity.indices[1] += displayA;
          }
        }
      }
      t.legacy.entities = entitySet;
    }
    for (let t of allTweets) {
      if (t.legacy?.entities?.urls) {
        for (const url of t.legacy.entities.urls) {
          console.log(url);
          url.display_url = url.expanded_url;
          console.log(url);

        }
      }
    }
    filter.write(encoder.encode(JSON.stringify(data)));
    filter.close();
  }

  return {};
}
browser.webRequest.onBeforeRequest.addListener(
  listenerTweetDetail,
  { urls: ["https://x.com/i/api/graphql/*/TweetDetail*"], },
  ["blocking"],
);
