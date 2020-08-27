import Loader from "react-loader-spinner";
import { CrashIcon, CrashAnalysis } from "../svgs";
import colorPallet from "../../misc/colorPallet";
import { useRouter } from "next/router";
import { useState, useContext, useEffect } from "react";
import AppContext from "../appContext";
import { getToken } from "../../misc/auth";
import fetch from "isomorphic-unfetch";

const CrashCard = (props) => {
  // console.log("Crash Card: ", props);
  const router = useRouter();
  const appState = useContext(AppContext);
  const [isLoading, setLoading] = useState(true);
  const [zeroState, setZeroState] = useState(true);

  const load = async (email) => {
    setLoading(true);

    const url = `${process.env.api_url}/api/lastRelapse`;
    const token = await getToken();

    // console.log("loading ", params);
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify({
        token,
        email,
      }),
    });

    const n = await response.json();

    // console.log("freedom card data: ", n);
    if (response.status !== 200) {
      router.push(`/error?page=health-freedomcard&status=${response.status}&message=${n.error}`);
    } else {
      // check to see if there is a last obect
      if (n.last && n.last === -1) {
        setZeroState(true);
      } else {
        setZeroState(false);
      }
    }

    setLoading(false);
  };

  useEffect(() => {
    // console.log("ccccc", props.data);
    if (appState.user.email) {
      load(appState.user.email);
    }
  }, [appState.user.email]);

  return (
    <div className="outer">
      <div
        className="container"
        onClick={() => {
          router.push("/crash");
        }}
      >
        <div className="header">
          <div style={{ display: "flex", alignItems: "center" }}>
            <CrashIcon width="24px" height="24px" fill={colorPallet.amber6} />
            <div className="title">Crash Analysis</div>
          </div>
        </div>
        <div className="body">
          {isLoading === true ? (
            <Loader type="Oval" color="#ffffff" height={30} width={75} />
          ) : zeroState === true ? (
            <>
              <div style={{ opacity: ".3" }}>
                <CrashAnalysis width="270px" height="270px" />
              </div>
              <div className="zeroStyle">
                <div style={{ maxWidth: "60%", textAlign: "center" }}>When was the last time you relapsed?</div>
                <button
                  className="primary-button-small"
                  style={{ marginTop: "30px" }}
                  onClick={() => {
                    appState.doAction("showModal", "showFaster");
                  }}
                >
                  Check In
                </button>
              </div>
            </>
          ) : (
            <CrashAnalysis width="270px" height="270px" />
          )}
        </div>
      </div>
      <style jsx>{`
        .zeroStyle {
          position: absolute;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 250px;
          width: 100%;
        }
        .header {
          display: flex;
          padding: 15px 15px 15px 20px;
          align-items: center;
          justify-content: space-between;
        }
        .body {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 300px;
        }
        .outer {
          max-width: 320px;
          width: 100%;
          height: 100%;
          background: linear-gradient(142.95deg, #1c2c40 7.91%, #020304 92.49%);
          box-shadow: 0px 6px 13px rgba(0, 0, 0, 0.5);
          border-radius: 5px;
        }
        .container {
          width: 100%;
          height: 100%;
          background-size: contain;
          background-repeat: no-repeat;
          box-shadow: 0px 6px 13px rgba(0, 0, 0, 0.5);
          border-radius: 5px;
          cursor: pointer;
        }
        .title {
          font-family: Montserrat;
          font-style: normal;
          font-weight: normal;
          font-size: 18px;
          line-height: 100%;
          margin-left: 20px;

          /* White */

          color: ${colorPallet.white};
          text-shadow: 0px 0px 15px #000000;
        }
        @media only screen and (max-width: 765px) {
          .outer {
            width: 100%;
            max-width: 100%;
          }
        }
      `}</style>
    </div>
  );
};

export default CrashCard;
