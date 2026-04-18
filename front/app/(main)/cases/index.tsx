import { Redirect } from "expo-router";

export default function CasesIndexRedirect() {
  return <Redirect href={"/learning" as never} />;
}
