// Things 3 bridge — runs inside `osascript -l JavaScript` (JXA).
//
// SECURITY: this file is executed verbatim. It is never concatenated with user
// input. All input arrives as a single JSON string in argv[0] and all output
// leaves as a single JSON string. Keep it that way.
//
// Request:  {"op": "<name>", "args": {...}}
// Response: {"ok": true, "data": ...} | {"ok": false, "error": "...", "errorNumber": -1743}

/* global Application */

var LIST_IDS = {
  inbox: "TMInboxListSource",
  today: "TMTodayListSource",
  anytime: "TMNextListSource",
  upcoming: "TMCalendarListSource",
  someday: "TMSomedayListSource",
  logbook: "TMLogbookListSource",
  trash: "TMTrashListSource",
};

function run(argv) {
  try {
    var req = JSON.parse(argv[0]);
    var op = OPS[req.op];
    if (!op) throw new Error("Unknown operation: " + req.op);
    var things = Application("Things3");
    return JSON.stringify({ ok: true, data: op(things, req.args || {}) });
  } catch (e) {
    return JSON.stringify({
      ok: false,
      error: String((e && e.message) || e),
      errorNumber: e && typeof e.errorNumber === "number" ? e.errorNumber : null,
    });
  }
}

// ---------- helpers ----------

function pad(n) {
  return n < 10 ? "0" + n : String(n);
}

// Things stores "when" and "deadline" as dates at local midnight.
function toDay(d) {
  if (!d) return null;
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function toIso(d) {
  return d ? d.toISOString() : null;
}

function fromDay(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error("Invalid date (expected YYYY-MM-DD): " + s);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function splitTags(s) {
  if (!s) return [];
  return s
    .split(",")
    .map(function (t) {
      return t.trim();
    })
    .filter(Boolean);
}

function safe(fn, fallback) {
  try {
    var v = fn();
    return v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function ref(obj) {
  if (!obj) return null;
  var id = safe(function () {
    return obj.id();
  }, null);
  if (!id) return null;
  return { id: id, name: safe(function () { return obj.name(); }, "") };
}

// Ids of open projects, fetched once per run (projects aren't in `things.toDos`).
var projectIdCache = null;
function isProject(things, id) {
  if (!projectIdCache) {
    projectIdCache = {};
    var ids = things.projects.id();
    for (var i = 0; i < ids.length; i++) projectIdCache[ids[i]] = true;
  }
  return projectIdCache[id] === true;
}

// Serialise one to-do/project by id.
// PERF: always address items with byId (~10ms). Index access like list.toDos[i] makes Things
// re-evaluate the whole list on every call (100ms+ per item, far worse in the Logbook).
function readItem(things, id) {
  var p = things.toDos.byId(id).properties();
  return {
    id: p.id,
    kind: isProject(things, p.id) ? "project" : "todo",
    title: p.name || "",
    notes: p.notes || "",
    status: p.status || "open",
    when: toDay(p.activationDate),
    deadline: toDay(p.dueDate),
    tags: splitTags(p.tagNames),
    project: ref(p.project),
    area: ref(p.area),
    createdAt: toIso(p.creationDate),
    modifiedAt: toIso(p.modificationDate),
    completedAt: toIso(p.completionDate || p.cancellationDate),
  };
}

function areaNameMap(things) {
  var ids = things.areas.id();
  var names = things.areas.name();
  var map = {};
  for (var i = 0; i < ids.length; i++) map[ids[i]] = names[i];
  return map;
}

// Read up to `limit` items from an element collection: one batched id fetch, then by-id reads.
function readCollection(things, coll, limit) {
  var ids = coll.id();
  var items = [];
  for (var i = 0; i < ids.length && i < limit; i++) items.push(readItem(things, ids[i]));
  return { total: ids.length, items: items };
}

// Writes to a project must go through things.projects (things.toDos.byId(projectId) can be read,
// but deleting or editing it fails with "Can't get object").
function getTodo(things, id) {
  var project = things.projects.byId(id);
  if (safe(function () { return project.id(); }, null)) return project;
  var item = things.toDos.byId(id);
  try {
    item.name(); // fail loudly here on a bad id, not later
  } catch (e) {
    throw new Error("No to-do or project found with id " + id);
  }
  return item;
}

function findByIdOrName(collection, value, label) {
  if (!value) return null;
  var byId = collection.byId(value);
  if (
    safe(function () {
      return byId.id();
    }, null)
  )
    return byId;
  var matches = collection.whose({ name: value })();
  if (matches.length === 0) throw new Error("No " + label + " found named or with id: " + value);
  return matches[0];
}

// when: "today" | "YYYY-MM-DD". Moves to inbox/anytime/someday are done by move.applescript,
// because JXA's `move` doesn't work with Things.
function applyWhen(things, item, when) {
  if (when === undefined || when === null) return;
  if (when === "inbox" || when === "anytime" || when === "someday") {
    throw new Error("List moves must go through move.applescript");
  }
  var date = when === "today" ? new Date() : fromDay(when);
  things.schedule(item, { for: date });
}

function applyContainer(things, item, args) {
  if (args.project) item.project = findByIdOrName(things.projects, args.project, "project");
  else if (args.area) item.area = findByIdOrName(things.areas, args.area, "area");
}

function applyFields(item, args) {
  if (args.title !== undefined) item.name = args.title;
  if (args.notes !== undefined) item.notes = args.notes;
  if (args.tags !== undefined) item.tagNames = args.tags.join(", ");
  if (args.deadline === null) {
    // Assigning null fails and assigning undefined sets 1904-01-01; deleting the property clears it.
    Application("Things3").delete(item.dueDate);
  } else if (args.deadline !== undefined) {
    item.dueDate = fromDay(args.deadline);
  }
}

// ---------- operations ----------

var OPS = {
  ping: function (things) {
    // version() is answered locally by JXA; counting lists forces a real Apple event,
    // so this fails properly when macOS hasn't granted Automation access.
    var lists = things.lists.length;
    return { version: things.version(), lists: lists };
  },

  list: function (things, args) {
    var id = LIST_IDS[args.list];
    if (!id) throw new Error("Unknown list: " + args.list);
    return readCollection(things, things.lists.byId(id).toDos, args.limit || 50);
  },

  project: function (things, args) {
    var project = findByIdOrName(things.projects, args.project, "project");
    var res = readCollection(things, project.toDos, args.limit || 100);
    res.container = readItem(things, project.id());
    return res;
  },

  area: function (things, args) {
    var area = findByIdOrName(things.areas, args.area, "area");
    var res = readCollection(things, area.toDos, args.limit || 100);
    res.container = ref(area);
    return res;
  },

  search: function (things, args) {
    // Batched title/notes fetch + filtering here is ~30x faster than a `whose` query in Things.
    var q = String(args.query || "").toLowerCase();
    var limit = args.limit || 50;
    var sources = [things.toDos, things.projects];
    if (args.includeCompleted) sources.push(things.lists.byId(LIST_IDS.logbook).toDos);
    var seen = {};
    var matches = [];
    for (var s = 0; s < sources.length; s++) {
      var ids = sources[s].id();
      var names = sources[s].name();
      var notes = sources[s].notes();
      for (var i = 0; i < ids.length; i++) {
        if (seen[ids[i]]) continue;
        if (String(names[i]).toLowerCase().indexOf(q) === -1 && String(notes[i]).toLowerCase().indexOf(q) === -1) continue;
        seen[ids[i]] = true;
        matches.push(ids[i]);
      }
    }
    var items = [];
    for (var j = 0; j < matches.length && items.length < limit; j++) {
      var item = readItem(things, matches[j]);
      if (!args.includeCompleted && item.status !== "open") continue;
      items.push(item);
    }
    return { total: matches.length, items: items };
  },

  get: function (things, args) {
    return readItem(things, getTodo(things, args.id).id());
  },

  projects: function (things, args) {
    var coll = things.projects;
    var ids = coll.id();
    var names = coll.name();
    var statuses = coll.status();
    var areaIds = safe(function () { return coll.area.id(); }, []);
    var areaNames = areaNameMap(things);
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      if (statuses[i] !== "open") continue;
      var area = areaIds[i] ? { id: areaIds[i], name: areaNames[areaIds[i]] || "" } : null;
      if (args.area && (!area || (area.id !== args.area && area.name !== args.area))) continue;
      out.push({ id: ids[i], title: names[i], area: area });
    }
    return out;
  },

  areas: function (things) {
    var coll = things.areas;
    var ids = coll.id();
    var names = coll.name();
    var out = [];
    for (var i = 0; i < ids.length; i++) out.push({ id: ids[i], title: names[i] });
    return out;
  },

  tags: function (things) {
    var coll = things.tags;
    var ids = coll.id();
    var names = coll.name();
    var parents = safe(function () { return coll.parentTag.name(); }, []);
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      out.push({ id: ids[i], title: names[i], parent: parents[i] || null });
    }
    return out;
  },

  addTodo: function (things, args) {
    var item = things.ToDo({ name: args.title });
    things.toDos.push(item);
    item = things.toDos.byId(item.id());
    applyFields(item, { notes: args.notes, tags: args.tags, deadline: args.deadline });
    applyContainer(things, item, args);
    applyWhen(things, item, args.when);
    return readItem(things, item.id());
  },

  addProject: function (things, args) {
    var project = things.Project({ name: args.title });
    things.projects.push(project);
    project = things.projects.byId(project.id());
    applyFields(project, { notes: args.notes, tags: args.tags, deadline: args.deadline });
    if (args.area) project.area = findByIdOrName(things.areas, args.area, "area");
    applyWhen(things, project, args.when);
    // Pushing straight into project.toDos doesn't attach them; create, then assign the project.
    var todos = args.todos || [];
    for (var i = 0; i < todos.length; i++) {
      var t = things.ToDo({ name: todos[i] });
      things.toDos.push(t);
      things.toDos.byId(t.id()).project = project;
    }
    projectIdCache = null;
    return readItem(things, project.id());
  },

  update: function (things, args) {
    var item = getTodo(things, args.id);
    applyFields(item, args);
    applyContainer(things, item, args);
    applyWhen(things, item, args.when);
    return readItem(things, args.id);
  },

  setStatus: function (things, args) {
    var item = getTodo(things, args.id);
    item.status = args.status;
    return readItem(things, args.id);
  },

  // Everything AppleScript can see, in batched reads (one Apple event per property per collection).
  // Used when the Things database can't be read (no Full Disk Access): no checklists, headings or
  // This Evening, but lists, projects, areas, tags, dates and order all work.
  snapshot: function (things, args) {
    var logbookLimit = args.logbookLimit || 500;
    function batch(coll) {
      var ids = safe(function () { return coll.id(); }, []);
      function col(fn) {
        return safe(fn, null) || [];
      }
      return {
        ids: ids,
        name: col(function () { return coll.name(); }),
        notes: col(function () { return coll.notes(); }),
        status: col(function () { return coll.status(); }),
        when: col(function () { return coll.activationDate(); }),
        due: col(function () { return coll.dueDate(); }),
        tags: col(function () { return coll.tagNames(); }),
        created: col(function () { return coll.creationDate(); }),
        modified: col(function () { return coll.modificationDate(); }),
        done: col(function () { return coll.completionDate(); }),
        canceled: col(function () { return coll.cancellationDate(); }),
      };
    }
    function rows(b, kind) {
      var out = [];
      for (var i = 0; i < b.ids.length; i++) {
        out.push({
          id: b.ids[i],
          kind: kind,
          title: b.name[i] || "",
          notes: b.notes[i] || "",
          status: b.status[i] || "open",
          when: toDay(b.when[i]),
          deadline: toDay(b.due[i]),
          tagNames: splitTags(b.tags[i]),
          createdAt: toIso(b.created[i]),
          modifiedAt: toIso(b.modified[i]),
          completedAt: toIso(b.done[i] || b.canceled[i]),
        });
      }
      return out;
    }
    function listIds(key) {
      return safe(function () { return things.lists.byId(LIST_IDS[key]).toDos.id(); }, []);
    }

    var lists = {};
    var keys = ["inbox", "today", "upcoming", "anytime", "someday", "trash"];
    for (var k = 0; k < keys.length; k++) lists[keys[k]] = listIds(keys[k]);

    // things.toDos / things.projects are the open items; finished ones live only in the Logbook.
    var todos = rows(batch(things.toDos), "todo");
    var projects = rows(batch(things.projects), "project");
    var projectIdSet = {};
    for (var q = 0; q < projects.length; q++) projectIdSet[projects[q].id] = true;
    var logbook = null;
    if (args.logbook) {
      // Batched over the whole list (it can hold thousands), then the newest `logbookLimit`.
      logbook = rows(batch(things.lists.byId(LIST_IDS.logbook).toDos), "todo").slice(0, logbookLimit);
    }

    // Containers: one batched id read per open project / area.
    var projectOf = {};
    var areaOf = {};
    for (var p = 0; p < projects.length; p++) {
      if (projects[p].status !== "open") continue;
      var pid = projects[p].id;
      var kids = safe(function () { return things.projects.byId(pid).toDos.id(); }, []);
      for (var c = 0; c < kids.length; c++) projectOf[kids[c]] = pid;
      var area = safe(function () { return things.projects.byId(pid).area.id(); }, null);
      if (area) areaOf[pid] = area;
    }
    var areaIds = things.areas.id();
    var areaNames = things.areas.name();
    for (var a = 0; a < areaIds.length; a++) {
      var aid = areaIds[a];
      var inArea = safe(function () { return things.areas.byId(aid).toDos.id(); }, []);
      for (var d = 0; d < inArea.length; d++) if (!areaOf[inArea[d]]) areaOf[inArea[d]] = aid;
    }
    var all = todos.concat(projects);
    for (var t = 0; t < all.length; t++) {
      all[t].projectId = projectOf[all[t].id] || null;
      all[t].areaId = all[t].projectId ? null : areaOf[all[t].id] || null;
    }

    var tagIds = safe(function () { return things.tags.id(); }, []);
    var tagNames = safe(function () { return things.tags.name(); }, []);
    var tagParents = safe(function () { return things.tags.parentTag.id(); }, []);
    var tags = [];
    for (var g = 0; g < tagIds.length; g++) tags.push({ id: tagIds[g], title: tagNames[g], parentId: tagParents[g] || null });
    var areas = [];
    for (var r = 0; r < areaIds.length; r++) areas.push({ id: areaIds[r], title: areaNames[r] });

    return { items: all, logbook: logbook, lists: lists, areas: areas, tags: tags };
  },

  // Not exposed as an MCP tool. Used only by the live test to clean up after itself.
  trash: function (things, args) {
    var item = getTodo(things, args.id);
    things.delete(item);
    return { id: args.id, trashed: true };
  },
};
