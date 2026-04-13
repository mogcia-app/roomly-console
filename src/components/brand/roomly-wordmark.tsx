type RoomlyWordmarkProps = {
  className?: string;
  dotClassName?: string;
};

export function RoomlyWordmark({ className = "", dotClassName = "" }: RoomlyWordmarkProps) {
  return (
    <span className={className}>
      Roomly<span className={dotClassName}>.</span>
    </span>
  );
}
