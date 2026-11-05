import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  layout("routes/shell.tsx", [
    index("routes/home.tsx"),
    // Workspace dashboards (sidebar visible) go here.
    route("surveys", "routes/surveys.tsx"),
    route("integrations", "routes/integrations.tsx"),
    route("exports", "routes/exports.tsx"),
    route("account", "routes/account.tsx"),

    // Workspace setup (once): fullscreen like an activity.
    route("onboarding", "routes/onboarding.tsx", [
      index("routes/onboarding.index.tsx"),
      route("connect", "routes/onboarding.connect.tsx"),
      route("sync", "routes/onboarding.sync.tsx"),
      route("surveys", "routes/onboarding.surveys.tsx"),
      route("done", "routes/onboarding.done.tsx"),
    ]),

    // Activities: fullscreen, keyed by id. The layout loads the activity; stages load data for its program.
    route("a/:activityId", "routes/activity.tsx", [
      index("routes/activity.index.tsx"),
      route("survey", "routes/activity.survey.tsx"),
      route("sync", "routes/activity.sync.tsx"),
      ...prefix("review", [
        layout("routes/review.tsx", [
          index("routes/review.index.tsx"),
          route("explore", "routes/review.explore.tsx"),
          route("diagnose", "routes/review.diagnose.tsx"),
          route("build", "routes/review.build.tsx"),
          route("packet", "routes/review.packet.tsx"),
          // connect / sync / survey moved to onboarding; old links redirect.
          route(":retired", "routes/review.retired.tsx"),
        ]),
      ]),
      ...prefix("outcomes", [
        layout("routes/outcomes.tsx", [
          index("routes/outcomes.index.tsx"),
          route("story", "routes/outcomes.story.tsx"),
          route("deeper", "routes/outcomes.deeper.tsx"),
          route("fix", "routes/outcomes.fix.tsx"),
          route("export", "routes/outcomes.export.tsx"),
          // scan (picking a program now happens on Programs) and say (now "story") redirect.
          route(":retired", "routes/outcomes.retired.tsx"),
        ]),
      ]),
    ]),
    // Old fixed URLs: redirect into the default program's live activity if there is one. Never creates one.
    route("review/*", "routes/legacy.tsx", { id: "legacy-review" }),
    route("outcomes/*", "routes/legacy.tsx", { id: "legacy-outcomes" }),
  ]),
  // Actions (no UI).
  route("activities/new", "routes/activities.new.tsx"),
  route("activities/:activityId", "routes/activities.$activityId.tsx"),
  route("api/sync", "routes/api.sync.tsx"),
  // Downloads.
  route("exports/:programId/:file", "routes/exports.file.tsx"),
  route("a/:activityId/outcomes/data.csv", "routes/outcomes.csv.tsx"),
  route("outcomes/data.csv", "routes/outcomes.csv.legacy.tsx"),
] satisfies RouteConfig;
