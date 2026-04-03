/**
 * Asana Read-Back Poller — periodically fetches task status from all 6 customer
 * Asana projects and syncs completions back to local compliance state.
 *
 * Runs every 60 seconds (configurable). Does NOT delete completed tasks —
 * only marks them with completedInAsana = true and updates linked cases/alerts.
 *
 * Requires: asana-project-resolver.js, webhook-receiver.js (for readback functions)
 */
(function(global) {
  'use strict';

  var POLL_INTERVAL = 60000; // 60 seconds
  var LAST_POLL_KEY = 'asana_readback_last_poll';
  var pollTimer = null;

  function getResolver() {
    return typeof AsanaProjectResolver !== 'undefined' ? AsanaProjectResolver : null;
  }

  /**
   * Fetch tasks from a single Asana project and detect newly completed ones.
   */
  async function fetchProjectCompletions(projectGid) {
    if (typeof asanaFetch !== 'function') return [];

    try {
      var res = await asanaFetch('/projects/' + projectGid + '/tasks?opt_fields=gid,name,completed&limit=100');
      if (!res.ok) return [];
      var data = await res.json();
      return (data.data || []).filter(function(t) { return t.completed; });
    } catch(e) {
      console.warn('[ReadbackPoller] Failed to fetch project ' + projectGid + ':', e.message);
      return [];
    }
  }

  /**
   * Read task links and find ones that Asana shows as completed but we haven't synced yet.
   */
  function findNewCompletions(completedTasks, taskLinks) {
    var completedGids = {};
    for (var i = 0; i < completedTasks.length; i++) {
      completedGids[completedTasks[i].gid] = completedTasks[i];
    }

    var newCompletions = [];
    for (var j = 0; j < taskLinks.length; j++) {
      var link = taskLinks[j];
      if (link.completedInAsana) continue; // Already known
      if (completedGids[link.asanaGid]) {
        newCompletions.push({
          link: link,
          task: completedGids[link.asanaGid]
        });
      }
    }
    return newCompletions;
  }

  /**
   * Main poll cycle — checks all customer projects for completed tasks.
   */
  async function pollAllProjects() {
    var resolver = getResolver();
    if (!resolver) return { synced: 0 };

    var TASK_LINKS_KEY = 'asana_task_links';
    var taskLinks;
    try { taskLinks = JSON.parse(localStorage.getItem(TASK_LINKS_KEY) || '[]'); }
    catch(e) { taskLinks = []; }

    if (taskLinks.length === 0) return { synced: 0 };

    // Get unique project GIDs from active links (only poll projects with pending tasks)
    var projectGids = {};
    for (var i = 0; i < taskLinks.length; i++) {
      if (!taskLinks[i].completedInAsana && taskLinks[i].projectGid) {
        projectGids[taskLinks[i].projectGid] = true;
      }
    }

    var gidList = Object.keys(projectGids);
    if (gidList.length === 0) return { synced: 0 };

    var totalSynced = 0;

    for (var g = 0; g < gidList.length; g++) {
      var completedTasks = await fetchProjectCompletions(gidList[g]);
      if (completedTasks.length === 0) continue;

      var newCompletions = findNewCompletions(completedTasks, taskLinks);

      for (var c = 0; c < newCompletions.length; c++) {
        var item = newCompletions[c];
        // Synthesize an event and let WebhookReceiver.processAsanaReadback handle it
        var syntheticEvent = {
          source: 'asana',
          type: 'task_completed',
          data: {
            gid: item.link.asanaGid,
            name: item.task.name,
            completed: true
          },
          timestamp: new Date().toISOString()
        };

        if (typeof WebhookReceiver !== 'undefined' && typeof WebhookReceiver.processAsanaReadback === 'function') {
          var results = WebhookReceiver.processAsanaReadback([syntheticEvent]);
          totalSynced += results.length;
        }
      }
    }

    // Record last poll time
    try { localStorage.setItem(LAST_POLL_KEY, new Date().toISOString()); } catch(e) {}

    if (totalSynced > 0) {
      console.log('[ReadbackPoller] Synced ' + totalSynced + ' completion(s) from Asana');
    }

    return { synced: totalSynced };
  }

  /**
   * Start the polling loop.
   */
  function start(options) {
    options = options || {};
    var interval = options.interval || POLL_INTERVAL;
    stop();
    // Initial poll after 5 seconds (let other modules initialize)
    setTimeout(function() {
      pollAllProjects();
      pollTimer = setInterval(pollAllProjects, interval);
    }, 5000);
    console.log('[ReadbackPoller] Started — polling every ' + (interval / 1000) + 's');
  }

  function stop() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function getLastPollTime() {
    return localStorage.getItem(LAST_POLL_KEY) || null;
  }

  // Expose API
  global.AsanaReadbackPoller = {
    start: start,
    stop: stop,
    pollNow: pollAllProjects,
    getLastPollTime: getLastPollTime,
  };

  // Auto-start if Asana is configured
  if (typeof window !== 'undefined') {
    window.addEventListener('load', function() {
      var hasToken = !!window.ASANA_TOKEN;
      var hasProxy = !!window.PROXY_URL;
      if (hasToken || hasProxy) {
        start();
      }
    });
  }

})(typeof window !== 'undefined' ? window : globalThis);
