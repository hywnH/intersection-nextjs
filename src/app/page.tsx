import StartScreen from "@/components/intro/StartScreen";

export default function IntroPage() {
  console.log("SSR hit");
  return (
    <div className="relative flex min-h-screen items-center bg-black px-6 py-16 text-white sm:px-12 lg:px-24">
      <StartScreen />
    </div>
  );
}
