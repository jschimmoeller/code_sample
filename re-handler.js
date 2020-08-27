const aws = require("aws-sdk");
const fetch = require("node-fetch");
const dateFns = require("date-fns");
const Bugsnag = require("@bugsnag/js");

/**********************************************
 * releases video based on meeting and week interval
 */

module.exports.release_videos = async (event) => {
  console.log("release videos process started");

  Bugsnag.start({
    apiKey: process.env.bugsnag_api_key,
    releaseStage: process.env.bugsnag_stage,
  });

  aws.config.update({
    accessKeyId: process.env.aws_id,
    secretAccessKey: process.env.aws_secret,
    region: process.env.dynamodb_region,
  });

  try {
    const r = await fetch(`${process.env.api_url}/api/series`, {
      method: "GET",
    });
    const series = await r.json();
    if (r.status !== 200) {
      throw new Error("get series failed with a status code: " + r.status + " data:" + JSON.stringify(series));
    }

    const getSeries = (theGroup) => {
      return series.reduce((p, c) => {
        if (!p) {
          if (c.id == theGroup.series_id) {
            return c;
          }
        }
        return p;
      }, undefined);
    };

    const docClient = new aws.DynamoDB.DocumentClient({
      apiVersion: "2012-08-10",
    });
    const todaysDate = new Date();

    // local groups -- week ahead and end date is 12 hours more
    // JES 05/12 - Ticket # 121 -  made it just like online groups
    const l = await docClient
      .query({
        TableName: process.env.db_table,
        IndexName: "gsi3",
        KeyConditionExpression: "gsi3_pk= :m and (gsi3_sk between :s and :e)",
        ExpressionAttributeValues: {
          ":m": "meeting",
          ":s": `M:local:${dateFns.getTime(dateFns.subHours(dateFns.addDays(todaysDate, 7), 12))}`,
          ":e": `M:local:${dateFns.getTime(dateFns.addHours(dateFns.addDays(todaysDate, 7), 12))}`,
        },
      })
      .promise();

    // online groups -- week ahead and end date is 12 hours more
    const o = await docClient
      .query({
        TableName: process.env.db_table,
        IndexName: "gsi3",
        KeyConditionExpression: "gsi3_pk= :m and gsi3_sk between :s and :e",
        ExpressionAttributeValues: {
          ":m": "meeting",
          ":s": `M:online:${dateFns.getTime(dateFns.subHours(dateFns.addDays(todaysDate, 7), 12))}`,
          ":e": `M:online:${dateFns.getTime(dateFns.addHours(dateFns.addDays(todaysDate, 7), 12))}`,
        },
      })
      .promise();

    // console.log("ooooo", JSON.stringify(o));
    // return;

    // new groups
    const qrv = {
      TableName: process.env.db_table,
      IndexName: "gsi3",
      KeyConditionExpression: "gsi3_pk= :m and begins_with(gsi3_sk, :t)",
      FilterExpression: "(created_ts between :s and :e)",
      ExpressionAttributeValues: {
        ":m": "group",
        ":t": `G:`,
        ":s": dateFns.getTime(dateFns.subHours(todaysDate, 24)),
        ":e": todaysDate.getTime(),
      },
    };
    const ng = await docClient.query(qrv).promise();
    // console.log("ng", qrv, ng);

    const items = []
      .concat(l.Items.length > 0 ? l.Items : [])
      .concat(o.Items.length > 0 ? o.Items : [])
      .concat(
        ng.Items.length > 0
          ? ng.Items.map((x) => {
              // have to changes gsi2_pk to group_uuid
              // process below uses group_type but group has that property
              x.gsi2_pk = x.pk;
              return x;
            })
          : []
      );

    // console.log("meeting count: " + items.length);
    for (var i = 0; i < items.length; i++) {
      // ok for each meeting process it
      const theMeeting = items[i];
      const g = await docClient
        .query({
          TableName: process.env.db_table,
          KeyConditionExpression: "pk= :g and begins_with(sk, :t)",
          ExpressionAttributeValues: {
            ":g": theMeeting.gsi2_pk,
            ":t": `G:`,
          },
        })
        .promise();
      // console.log("g", JSON.stringify(g, null, 2));

      if (g.Items.length < 1) {
        // throw new Error("missing group from group table " + theMeeting.gsi2_pk);
        continue;
      }
      const theGroup = g.Items[0];
      if (!theGroup.attributes.when || !theGroup.attributes.when.hasOwnProperty("start_date")) {
        console.log("no start date for this group so i will skip it");
        continue;
      }
      // get weeks since start of meeting
      const days = dateFns.differenceInCalendarDays(dateFns.addHours(dateFns.addDays(todaysDate, 7), 12), new Date(theGroup.attributes.when.start_date));

      // bi weekly mieetings we divide by 14  not 7
      const weeks =
        days < 7 && days > 0 ? 1 : !theGroup.attributes.when.hasOwnProperty("mtgInterval") || theGroup.attributes.when.mtgInterval === "Weekly" ? Math.ceil(days / 7) : Math.ceil(days / 14);
      console.log("start date  and weeks for this group: ", theGroup.attributes.when.start_date, " days: ", days, " weeks: ", weeks);

      // releaesed episodes array
      const re = [];
      // modules ?
      const hasModule = theGroup.attributes.series.hasOwnProperty("module") && theGroup.attributes.series.module && !isNaN(parseInt(theGroup.attributes.series.module));

      if (hasModule === true) {
        console.log("THIS IS A MODULE GROUP ");
        const theSeries = getSeries(theGroup);
        // filter episodes
        const m = parseInt(theGroup.attributes.series.module);
        const modules = theSeries.modules[m];
        for (let j = 0; j < weeks; j++) {
          if (modules.episode_nbrs[j]) {
            re.push(parseInt(modules.episode_nbrs[j]));
          } else {
            break;
          }
        }
      } else {
        for (let j = 0; j < weeks; j++) {
          // console.log("jjjjjjj", j);
          const theSeries = getSeries(theGroup);
          // console.log(theSeries);
          // if the episodes length < j+ 1 then we can release it ... else out of range
          if (theSeries && theSeries.episodes.length < j + 1) {
            break;
          }
          re.push(j + 1);
        }
      }

      // end change here for released videos

      console.log("new released episodes", re, "group: ", theGroup.pk, "old released: ", theGroup.attributes.released_episodes);

      theGroup.attributes.released_episodes = re;
      // console.log("updatng group: ", theGroup);
      //save group
      await docClient
        .put({
          TableName: process.env.db_table,
          Item: theGroup,
        })
        .promise();
    }
    // console.log("release video finished and updated the following items: ", m);

    return;
  } catch (e) {
    console.log("master error: ", e);
    Bugsnag.notify(e, (x) => {
      x.addMetadata("serverless_details", {
        api_func_name: "release-vidoes",
      });
    });
  }
};
