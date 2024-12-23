console.log('FEEDER INJECTED');

const rectangle = document.createElement('div');
rectangle.style.cssText = 'width: 10px; height: 10px; background-color: red; position: fixed; top: 0; left: 0;';
document.body.appendChild(rectangle);

function addControls(el) {
    if (el.querySelector('._TwControl')) return;
    let tweetId = null;

    el.querySelectorAll('time').forEach(i => {
        const p = i.parentElement;
        if (p.tagName === 'A' && p.href.includes('/status/')) {
            tweetId = p.href.match(/\/status\/(\d+)/)[1];
        }
    });

    const containerEl = document.createElement('div');
    containerEl.className = '_TwControl';
    containerEl.style = 'position: absolute;left: 100%;height: 100%;width: 2em;background: red;top: 0;border: 2px solid green;';

    const temp = document.createElement('div');
    temp.innerText = tweetId;
    containerEl.appendChild(temp);

    el.appendChild(containerEl);
}

const callback = function (mutationsList, observer) {
    for (let mutation of mutationsList) {
        if (mutation.type === 'childList') {
            mutation.addedNodes.forEach((el) => {
                // data-testid="tweet"
                if (el.matches && el.matches('[data-testid="cellInnerDiv"]')) {
                    const tweet = el.querySelector('[data-testid="tweet"]');
                    if (!tweet) return;
                    console.log('Added: ', el);
                    addControls(el);

                }
            });
            // mutation.removedNodes.forEach((el) => {
            //     const tweet = el.querySelector('[data-testid="tweet"]');
            //     if (!tweet) return;
            //     if (el.matches && el.matches('[data-testid="cellInnerDiv"]')) {
            //         console.log('Removed: ', el);
            //     }
            // });
        }
    }
};

const obs = {};

const intervalId = setInterval(() => {
    const targetNodes = document.querySelectorAll('[aria-label="Timeline: Your Home Timeline"] > div');
    for (let targetNode of targetNodes) {
        if (obs[targetNode]) continue;
        obs[targetNode] = 1;
        console.log('adding observer to', targetNode);
        const observer = new MutationObserver(callback);
        observer.observe(targetNode, { attributes: false, childList: true, subtree: false });
        targetNode.querySelectorAll('[data-testid="cellInnerDiv"]').forEach(el => {
            console.log('late add', el);
            const tweet = el.querySelector('[data-testid="tweet"]');
            if (!tweet) return;
            addControls(el);
        });
        // clearInterval(intervalId);
    }
}, 200);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(checkFn) {
    for (let i = 0; i < 100; i++) {
        const result = checkFn();
        if (result.length !== undefined) {
            if (result.length > 0) {
                return result;
            }
        } else if (result) {
            return result;
        }
        await sleep(20);
    }
    throw new Error('Element not found within the maximum number of tries');
}

const findNextElement = (current, selector) => {
    const elements = document.querySelectorAll(selector);
    const index = Array.from(elements).indexOf(current);
    return elements[index + 1] || null;
};

document.body.addEventListener('keydown', async (e) => {
    if (e.key !== 'z' && e.key !== 'a' && e.key !== 'q' && e.key !== 'h' && e.key != 'y') return;
    if (document.activeElement !== e.target) return;
    const el = e.target;
    if (!(el.tagName === 'ARTICLE' && el.getAttribute('data-testid') === "tweet")) return;
    console.log('tweet focused', e, el);
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'q') {  // alias for `j`, go to next tweet
        document.body.dispatchEvent(new KeyboardEvent('keypress', { which: 106, bubbles: true }));
        return;
    }

    if (e.key === 'a' || e.key === 'h') {  // open focused tweet in a new tab
        const tweetLink = Array.from(el.querySelectorAll('a'))
            .filter(el => el.href.match(/\/status\/\d+$/))[0];
        browser.runtime.sendMessage({ action: "openNewTab", url: tweetLink.href });
        return;
    }

    if (e.key !== 'z' && e.key !== 'y') return;  // not interested
    const elCell = el.closest('[data-testid="cellInnerDiv"]');
    const nextTweet = findNextElement(el, 'article[data-testid="tweet"]');

    const menu = el.querySelector('button[aria-label="More"]');
    menu.click();

    let dd = await wait(() => document.querySelectorAll('[data-testid="Dropdown"]'));
    console.log('dropdowns', dd);
    if (dd.length !== 1) return;

    const unintBtn = Array.from(dd[0].querySelectorAll('[role="menuitem"]'))
        .filter(el => (el.textContent === "Not interested in this post"))[0];
    unintBtn.click();

    elCell.style.height = '160px';
    elCell.style.maxHeight = '160px';

    await sleep(0);
    // console.log('text cnt', elCell.textContent);
    try {
        await wait(() => (
            !elCell.parentNode
            || elCell.textContent.includes('to make your timeline better')
        ));
    } catch (e) {
        console.log('text cnt', elCell.textContent);
        throw e;
    }
    // console.log('text cnt', elCell.textContent);
    console.log('t', elCell.getBoundingClientRect().height);

    await sleep(5);
    console.log('t', elCell.getBoundingClientRect().height);

    document.body.dispatchEvent(new KeyboardEvent('keypress', { which: 106, bubbles: true }));
    await sleep(0);
    nextTweet.focus({preventScroll: true, focusVisible: true});
    // document.activeElement = nextTweet;

    // document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));

    if (nextTweet) {
        // nextTweet.focus({preventScroll: true, focusVisible: true});
        // nextTweet.scrollIntoView(true);
        // window.scrollBy(0, -52);
        // document.activeElement = nextTweet;
    }

    // await sleep(1200);
    // console.log('t', elCell.getBoundingClientRect().height);
});
